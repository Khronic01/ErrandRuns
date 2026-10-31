-- Errand Runs Lagos: who can see and change what.
-- Apps read through RLS and write only through the functions in the order engine.

-- ---------------------------------------------------------------- function privileges
-- Internal functions are never callable by app users directly.
revoke all on all functions in schema app from public;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;
-- Helpers that RLS policies call run as the querying user, so they need execute.
grant execute on function app.uid(), app.jwt_role(), app.is_service(), app.is_staff(public.staff_role[])
  to anon, authenticated, service_role;

-- Public functions: deny by default, then grant per audience.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_tracking(text)  to anon, authenticated;
grant execute on function public.join_waitlist(text, text, text, double precision, double precision, text) to anon, authenticated;
grant execute on function public.quote_job(jsonb)    to anon, authenticated;
grant execute on function
  public.create_job(jsonb),
  public.cancel_job(uuid, public.failure_reason, text),
  public.decide_change(uuid, boolean),
  public.raise_emergency(uuid, text),
  -- runner
  public.set_online(boolean),
  public.respond_to_offer(uuid, boolean),
  public.transition_job(uuid, public.job_status, text, public.failure_reason),
  public.raise_change(uuid, public.change_kind, bigint, text),
  public.add_proof(uuid, public.proof_kind, text, int),
  public.complete_job(uuid, text),
  public.record_locations(uuid, jsonb),
  -- ops (each checks the staff role inside)
  public.suggest_runners(uuid, int),
  public.offer_job(uuid, uuid, int),
  public.ops_assign(uuid, uuid, text),
  public.ops_adjust_price(uuid, bigint, text),
  public.issue_refund(uuid, bigint, text, boolean),
  public.record_float(uuid, bigint, text),
  public.ops_set_runner_status(uuid, public.runner_status, text),
  public.activate_price_table(uuid, text),
  public.draft_price_table_from(uuid, text),
  public.ops_alerts()
to authenticated;
-- Payment webhooks run with the service role.
grant execute on function public.confirm_payment(text, text, bigint, jsonb), public.attach_payment_ref(uuid, text)
  to service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------- table privileges
-- No direct writes from apps except the few tables below.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
-- Anonymous visitors read nothing directly; the tracking link goes through get_tracking.
revoke select on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant select on public.zones to anon;
grant insert, update on public.profiles to authenticated;
grant insert on public.runners to authenticated;
grant update (full_name, vehicle, plate, home_address, photo_path, id_doc_type, id_doc_path, selfie_path, guarantor, bank)
  on public.runners to authenticated;
grant insert, update, delete on public.zones, public.prohibited_items, public.zone_fares, public.task_fees, public.size_fees
  to authenticated;
grant insert, update on public.price_tables to authenticated;
revoke select on public.payment_events from authenticated;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- A job is visible to its customer, its runner, a runner holding a live offer for it, and staff.
create or replace function app.can_see_job(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_staff() or app.is_service() or exists (
    select 1 from public.jobs j
    where j.id = p_job
      and (j.customer_id = auth.uid()
           or j.runner_id = auth.uid()
           or exists (select 1 from public.offers o
                      where o.job_id = j.id and o.runner_id = auth.uid() and o.response = 'pending')))
$$;
grant execute on function app.can_see_job(uuid) to anon, authenticated, service_role;

-- people
create policy profiles_self on public.profiles for select using (id = auth.uid() or app.is_staff());
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy staff_read on public.staff for select using (user_id = auth.uid() or app.is_staff('admin'));

create policy runners_read on public.runners for select using (user_id = auth.uid() or app.is_staff());
create policy runners_apply on public.runners for insert
  with check (user_id = auth.uid() and status = 'applied' and not online and verified_at is null);
create policy runners_update_own on public.runners for update
  using (user_id = auth.uid() and status in ('applied', 'in_review')) with check (user_id = auth.uid());

-- zones, policy data
create policy zones_read on public.zones for select using (true);
create policy zones_write on public.zones for all using (app.is_staff('ops_lead', 'admin')) with check (app.is_staff('ops_lead', 'admin'));
create policy waitlist_read on public.waitlist for select using (app.is_staff());
create policy prohibited_read on public.prohibited_items for select using (app.is_staff());
create policy prohibited_write on public.prohibited_items for all using (app.is_staff('ops_lead', 'admin')) with check (app.is_staff('ops_lead', 'admin'));

-- pricing: staff only; customers never see the cost side
create policy price_tables_read on public.price_tables for select using (app.is_staff());
create policy price_tables_write on public.price_tables for insert with check (app.is_staff('ops_lead', 'admin') and status = 'draft');
create policy price_tables_update on public.price_tables for update using (app.is_staff('ops_lead', 'admin'));
create policy zone_fares_read on public.zone_fares for select using (app.is_staff());
create policy zone_fares_write on public.zone_fares for all using (app.is_staff('ops_lead', 'admin')) with check (app.is_staff('ops_lead', 'admin'));
create policy task_fees_read on public.task_fees for select using (app.is_staff());
create policy task_fees_write on public.task_fees for all using (app.is_staff('ops_lead', 'admin')) with check (app.is_staff('ops_lead', 'admin'));
create policy size_fees_read on public.size_fees for select using (app.is_staff());
create policy size_fees_write on public.size_fees for all using (app.is_staff('ops_lead', 'admin')) with check (app.is_staff('ops_lead', 'admin'));

-- orders
create policy jobs_read on public.jobs for select using (app.can_see_job(id));
create policy job_stops_read on public.job_stops for select using (app.can_see_job(job_id));
create policy job_economics_read on public.job_economics for select using (app.is_staff());
create policy job_secrets_read on public.job_secrets for select
  using (exists (select 1 from public.jobs j where j.id = job_id and j.customer_id = auth.uid()));
-- Customers and runners see the job's progress, not ops' internal notes.
create policy job_events_read on public.job_events for select
  using (app.is_staff() or (app.can_see_job(job_id)
         and kind in ('transition', 'change_request', 'change_decision', 'proof')));
create policy change_requests_read on public.change_requests for select using (app.can_see_job(job_id));
create policy proofs_read on public.proofs for select using (app.can_see_job(job_id));
create policy ratings_read on public.ratings for select
  using (customer_id = auth.uid() or runner_id = auth.uid() or app.is_staff());

-- dispatch & tracking
create policy offers_read on public.offers for select using (runner_id = auth.uid() or app.is_staff());
create policy location_read on public.location_events for select using (runner_id = auth.uid() or app.is_staff());

-- money
create policy payments_read on public.payments for select
  using (app.is_staff() or exists (select 1 from public.jobs j where j.id = job_id and j.customer_id = auth.uid()));
create policy floats_read on public.job_floats for select using (runner_id = auth.uid() or app.is_staff());
create policy earnings_read on public.runner_earnings for select using (runner_id = auth.uid() or app.is_staff());
create policy payouts_read on public.payouts for select using (runner_id = auth.uid() or app.is_staff());
create policy wallet_read on public.wallet_entries for select using (customer_id = auth.uid() or app.is_staff());

-- audit
create policy audit_read on public.audit_log for select using (app.is_staff('ops_lead', 'finance', 'admin'));

-- ---------------------------------------------------------------- Supabase platform hooks (skipped where absent)
do $$
begin
  -- Live updates for the customer tracker, runner app and ops board.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs, public.job_events, public.offers, public.change_requests;
  end if;

  -- Private buckets for proof photos and runner documents.
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values
      ('proofs', 'proofs', false), ('runner-docs', 'runner-docs', false)
    on conflict (id) do nothing;

    -- proofs/<job_id>/<file>: the runner on the job uploads; anyone who can see the job reads.
    execute $p$create policy proofs_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'proofs' and exists (
        select 1 from public.jobs j where j.id::text = (storage.foldername(name))[1] and j.runner_id = auth.uid()))$p$;
    execute $p$create policy proofs_read on storage.objects for select to authenticated
      using (bucket_id = 'proofs' and app.can_see_job(((storage.foldername(name))[1])::uuid))$p$;
    -- runner-docs/<user_id>/<file>: the runner and staff only.
    execute $p$create policy runner_docs_own on storage.objects for all to authenticated
      using (bucket_id = 'runner-docs' and ((storage.foldername(name))[1] = auth.uid()::text or app.is_staff()))
      with check (bucket_id = 'runner-docs' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;

  -- Time rules every minute.
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('errand-runs-time-rules', '* * * * *', 'select app.enforce_time_rules()');
  end if;
end $$;

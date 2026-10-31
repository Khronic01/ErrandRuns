-- Errand Runs Lagos: order engine
-- Rule (PRD): state changes happen only through one server function that checks
-- the allowed transition; apps never write status directly. Here that function
-- is app.apply_transition, reached only through the public functions below,
-- and a trigger rejects any status write that does not come through it.

-- ---------------------------------------------------------------- identity helpers
create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.jwt_role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

create or replace function app.is_service() returns boolean
language sql stable as $$ select app.jwt_role() = 'service_role' $$;

create or replace function app.staff_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.user_id = auth.uid() and s.active
$$;

create or replace function app.is_staff(variadic p_roles public.staff_role[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = auth.uid() and s.active
      and (p_roles is null or s.role = any (p_roles))
  )
$$;

create or replace function app.actor_role_for(p_job public.jobs) returns public.actor_role
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.is_service() then return 'system'; end if;
  if app.is_staff() then return 'ops'; end if;
  if p_job.runner_id is not null and p_job.runner_id = auth.uid() then return 'runner'; end if;
  if p_job.customer_id = auth.uid() then return 'customer'; end if;
  return null;
end $$;

create or replace function app.require(p_cond boolean, p_code text, p_detail text default null) returns void
language plpgsql immutable as $$
begin
  if not coalesce(p_cond, false) then
    raise exception '%', p_code using detail = coalesce(p_detail, p_code), errcode = 'P0001';
  end if;
end $$;

create or replace function app.audit(
  p_action text, p_entity text, p_entity_id text, p_reason text,
  p_before jsonb default null, p_after jsonb default null, p_role public.actor_role default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, reason, before, after)
  values (
    auth.uid(),
    coalesce(p_role, case when app.is_service() then 'system'::public.actor_role
                          when app.is_staff() then 'ops'::public.actor_role
                          else 'customer'::public.actor_role end),
    p_action, p_entity, p_entity_id, p_reason, p_before, p_after
  );
end $$;

-- ---------------------------------------------------------------- the state machine
create table app.transitions (
  from_status public.job_status not null,
  to_status   public.job_status not null,
  roles       public.actor_role[] not null,
  primary key (from_status, to_status)
);

insert into app.transitions (from_status, to_status, roles) values
  ('quoted',            'paid',              '{system}'),
  ('quoted',            'cancelled',         '{customer,ops,system}'),
  ('paid',              'assigned',          '{runner,ops,system}'),
  ('paid',              'needs_ops',         '{ops,system}'),
  ('paid',              'cancelled',         '{customer,ops}'),
  ('needs_ops',         'assigned',          '{ops}'),
  ('needs_ops',         'cancelled',         '{ops}'),
  ('needs_ops',         'failed',            '{ops}'),
  ('assigned',          'picked_up',         '{runner,ops}'),
  ('assigned',          'customer_approval', '{runner,ops}'),
  ('assigned',          'needs_ops',         '{runner,ops,system}'),
  ('assigned',          'cancelled',         '{customer,ops}'),
  ('assigned',          'failed',            '{ops}'),
  ('picked_up',         'on_the_way',        '{runner,ops}'),
  ('picked_up',         'customer_approval', '{runner,ops}'),
  ('picked_up',         'needs_ops',         '{runner,ops,system}'),
  ('picked_up',         'cancelled',         '{ops}'),
  ('picked_up',         'failed',            '{ops}'),
  ('on_the_way',        'completed',         '{runner}'),          -- only with proof + OTP, via complete_job
  ('on_the_way',        'customer_approval', '{runner,ops}'),
  ('on_the_way',        'needs_ops',         '{runner,ops,system}'),
  ('on_the_way',        'cancelled',         '{ops}'),
  ('on_the_way',        'failed',            '{ops}'),
  ('customer_approval', 'needs_ops',         '{customer,ops,system}'),
  ('customer_approval', 'cancelled',         '{customer,ops}'),
  ('customer_approval', 'failed',            '{ops}');

-- Leaving a holding state back to where the job was is allowed for these roles.
create table app.holding_returns (
  holding public.job_status primary key,
  roles   public.actor_role[] not null
);
insert into app.holding_returns values
  ('needs_ops',         '{ops,system}'),
  ('customer_approval', '{customer,ops,system}');

create or replace function app.apply_transition(
  p_job_id uuid, p_to public.job_status, p_role public.actor_role,
  p_reason text default null, p_data jsonb default '{}'::jsonb
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  ok boolean;
  v_from public.job_status;
begin
  select * into j from public.jobs where id = p_job_id for update;
  perform app.require(found, 'JOB_NOT_FOUND');
  v_from := j.status;
  perform app.require(j.status not in ('completed', 'cancelled', 'failed'), 'JOB_CLOSED',
                      format('Job %s is already %s', j.ref, j.status));

  if j.status in ('needs_ops', 'customer_approval') and p_to = j.previous_status then
    select p_role = any (h.roles) into ok from app.holding_returns h where h.holding = j.status;
  else
    select p_role = any (t.roles) into ok from app.transitions t
     where t.from_status = j.status and t.to_status = p_to;
  end if;
  perform app.require(ok, 'TRANSITION_NOT_ALLOWED',
                      format('%s cannot move job %s from %s to %s', p_role, j.ref, j.status, p_to));

  if p_to in ('cancelled', 'failed') then
    perform app.require(j.failure_reason is not null or (p_data ? 'reason_code'), 'REASON_REQUIRED',
                        'Cancelled and failed jobs need a reason code');
  end if;

  perform set_config('app.in_transition', 'on', true);
  update public.jobs set
    status          = p_to,
    previous_status = case
                        when p_to in ('needs_ops', 'customer_approval')
                          then case when j.status in ('needs_ops', 'customer_approval') then j.previous_status else j.status end
                        else null end,
    failure_reason  = coalesce((p_data ->> 'reason_code')::public.failure_reason, failure_reason),
    failure_note    = coalesce(p_data ->> 'note', failure_note),
    paid_at         = case when p_to = 'paid' then now() else paid_at end,
    assigned_at     = case when p_to = 'assigned' then now() else assigned_at end,
    completed_at    = case when p_to = 'completed' then now() else completed_at end,
    closed_at       = case when p_to in ('completed', 'cancelled', 'failed') then now() else closed_at end,
    updated_at      = now()
  where id = j.id
  returning * into j;
  perform set_config('app.in_transition', 'off', true);

  insert into public.job_events (job_id, kind, from_status, to_status, actor_id, actor_role, reason, data)
  values (j.id, 'transition', v_from, p_to, auth.uid(), p_role, p_reason, p_data);
  return j;
end $$;

-- Reject any status write that bypasses apply_transition, even from the service role.
create or replace function app.guard_job_writes() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.in_transition', true), 'off') <> 'on' then
    if new.status is distinct from old.status or new.previous_status is distinct from old.previous_status then
      raise exception 'STATUS_WRITE_FORBIDDEN' using detail = 'Job status changes only through the order engine';
    end if;
  end if;
  if old.status <> 'quoted' and (new.price_kobo, new.quote, new.price_table_id)
                                is distinct from (old.price_kobo, old.quote, old.price_table_id) then
    raise exception 'PRICE_FROZEN' using detail = 'A paid job keeps the quote it was paid at';
  end if;
  return new;
end $$;

create trigger jobs_guard before update on public.jobs
  for each row execute function app.guard_job_writes();

-- ---------------------------------------------------------------- zones
create or replace function app.zone_at(p_lat double precision, p_lng double precision) returns uuid
language sql stable security definer set search_path = '' as $$
  select z.id from public.zones z
  where z.active
    and extensions.st_covers(z.area, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
  order by extensions.st_area(z.area) asc
  limit 1
$$;

-- ---------------------------------------------------------------- pricing
create or replace function app.payment_fee(t public.price_tables, p_amount bigint) returns bigint
language sql immutable as $$
  select least(
    round(p_amount * t.payment_fee_rate)::bigint
      + case when p_amount >= t.payment_fee_flat_from_kobo then t.payment_fee_flat_kobo else 0 end,
    t.payment_fee_cap_kobo)
$$;

create or replace function app.is_peak(t public.price_tables, p_at timestamptz) returns boolean
language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(t.peak_windows) w
    where extract(isodow from p_at at time zone 'Africa/Lagos')::int
            in (select jsonb_array_elements_text(w -> 'dow')::int)
      and (p_at at time zone 'Africa/Lagos')::time >= (w ->> 'start')::time
      and (p_at at time zone 'Africa/Lagos')::time <  (w ->> 'end')::time
  )
$$;

-- Price = zone fare(A→B) + task fee + extra stops × stop fee + size fee + peak surcharge
-- Contribution = Price − (runner pay + payment fee + ops cost + contingency)
-- If contribution < margin floor × price, the price is raised in rounding steps until it clears.
create or replace function app.compute_quote(
  t public.price_tables, p_task public.task_type, p_from uuid, p_to uuid,
  p_extra_stops int, p_size public.item_size, p_at timestamptz, p_item_budget bigint default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  fare bigint; task_fee bigint := 0; size_fee bigint := 0; stops_fee bigint; peak bigint := 0;
  base bigint; price bigint; runner_pay bigint; fee bigint; ops bigint; cont bigint; contribution bigint;
  floor_applied boolean := false; steps int := 0;
  lines jsonb;
begin
  select f.fare_kobo into fare from public.zone_fares f
   where f.price_table_id = t.id and f.from_zone_id = p_from and f.to_zone_id = p_to;
  if fare is null then  -- fares are symmetric unless a reverse fare is set
    select f.fare_kobo into fare from public.zone_fares f
     where f.price_table_id = t.id and f.from_zone_id = p_to and f.to_zone_id = p_from;
  end if;
  perform app.require(fare is not null, 'NO_FARE', 'No fare is set for this zone pair yet');

  select coalesce((select tf.fee_kobo from public.task_fees tf where tf.price_table_id = t.id and tf.task_type = p_task), 0)
    into task_fee;
  if p_size is not null then
    select coalesce((select sf.fee_kobo from public.size_fees sf where sf.price_table_id = t.id and sf.size = p_size), 0)
      into size_fee;
  end if;
  stops_fee := greatest(p_extra_stops, 0) * t.stop_fee_kobo;
  if app.is_peak(t, p_at) then peak := t.peak_surcharge_kobo; end if;

  base  := fare + task_fee + stops_fee + size_fee + peak;
  price := ceil(base::numeric / t.round_to_kobo)::bigint * t.round_to_kobo;

  loop
    runner_pay   := round(price * t.runner_share, -2)::bigint;          -- whole naira
    fee          := app.payment_fee(t, price + coalesce(p_item_budget, 0)); -- Paystack charges on the whole amount
    ops          := t.ops_cost_per_job_kobo;
    cont         := round(price * t.contingency_rate, -2)::bigint;
    contribution := price - (runner_pay + fee + ops + cont);
    exit when contribution >= ceil(price * t.margin_floor) or steps >= 400;
    price := price + t.round_to_kobo;
    floor_applied := true;
    steps := steps + 1;
  end loop;
  perform app.require(contribution >= ceil(price * t.margin_floor), 'NEEDS_OPS_PRICING',
                      'This job cannot be priced above the margin floor automatically');

  -- Customer-visible lines. Any floor uplift is folded into the trip fare.
  lines := jsonb_build_array(jsonb_build_object('code', 'fare', 'label', 'Trip fare', 'amount_kobo', fare + (price - base)));
  if task_fee  > 0 then lines := lines || jsonb_build_object('code', 'task',  'label', 'Task fee',     'amount_kobo', task_fee); end if;
  if stops_fee > 0 then lines := lines || jsonb_build_object('code', 'stops', 'label', 'Extra stop' || case when p_extra_stops > 1 then 's' else '' end, 'amount_kobo', stops_fee); end if;
  if size_fee  > 0 then lines := lines || jsonb_build_object('code', 'size',  'label', 'Item size',    'amount_kobo', size_fee); end if;
  if peak      > 0 then lines := lines || jsonb_build_object('code', 'peak',  'label', 'Peak hours',   'amount_kobo', peak); end if;

  return jsonb_build_object(
    'price_kobo', price,
    'item_budget_kobo', coalesce(p_item_budget, 0),
    'total_due_kobo', price + coalesce(p_item_budget, 0),
    'lines', lines,
    'may_add', jsonb_build_array(
      format('Waiting beyond %s free minutes', t.free_wait_minutes),
      'An extra stop added during the job',
      'Items costing more than your budget (you approve first)'),
    'price_table_version', t.version,
    'economics', jsonb_build_object(
      'runner_pay_kobo', runner_pay, 'payment_fee_kobo', fee, 'ops_cost_kobo', ops,
      'contingency_kobo', cont, 'contribution_kobo', contribution,
      'contribution_rate', round(contribution::numeric / price, 4),
      'floor_applied', floor_applied)
  );
end $$;

create or replace function app.active_price_table() returns public.price_tables
language plpgsql stable security definer set search_path = '' as $$
declare t public.price_tables;
begin
  select * into t from public.price_tables where status = 'active';
  perform app.require(found, 'NO_ACTIVE_PRICE_TABLE');
  return t;
end $$;

-- Validates the stops and returns zones + quote. Shared by quote_job and create_job.
create or replace function app.price_request(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.price_tables := app.active_price_table();
  v_task public.task_type := (p ->> 'task_type')::public.task_type;
  v_stops jsonb := coalesce(p -> 'stops', '[]'::jsonb);
  n int := jsonb_array_length(coalesce(p -> 'stops', '[]'::jsonb));
  zone_ids uuid[] := '{}';
  z uuid; s jsonb; i int := 0;
  v_budget bigint := coalesce((p ->> 'item_budget_kobo')::bigint, 0);
  v_value  bigint := coalesce((p ->> 'item_value_kobo')::bigint, 0);
  v_at timestamptz := coalesce((p ->> 'scheduled_for')::timestamptz, now());
  q jsonb;
begin
  perform app.require(v_task is not null, 'TASK_TYPE_REQUIRED');
  perform app.require(n between 1 and 3, 'STOPS_INVALID', 'A job has 1 to 3 stops');
  perform app.require(case v_task
                        when 'send'          then n = 2
                        when 'multi_stop'    then n = 3
                        when 'buy_and_bring' then n >= 2
                        when 'collect'       then n >= 2
                        else true end,
                      'STOPS_INVALID', format('Wrong number of stops for %s', v_task));
  perform app.require(v_budget >= 0 and v_value >= 0, 'AMOUNT_INVALID');
  perform app.require(greatest(v_budget, v_value) <= t.item_value_cap_kobo, 'ITEM_VALUE_CAP',
                      format('Item value is capped at ₦%s during the pilot', to_char(t.item_value_cap_kobo / 100, 'FM999,999,999')));
  perform app.require(v_task <> 'buy_and_bring' or v_budget > 0, 'BUDGET_REQUIRED', 'Buy & bring needs an item budget');

  for s in select * from jsonb_array_elements(v_stops) loop
    i := i + 1;
    z := app.zone_at((s ->> 'lat')::float8, (s ->> 'lng')::float8);
    perform app.require(z is not null, 'OUTSIDE_ZONE', format('Stop %s is outside our current service area', i));
    zone_ids := zone_ids || z;
  end loop;

  q := app.compute_quote(t, v_task, zone_ids[1], zone_ids[n], greatest(n - 2, 0),
                         (p ->> 'item_size')::public.item_size, v_at, v_budget);
  return q || jsonb_build_object('zone_ids', to_jsonb(zone_ids), 'price_table_id', t.id);
end $$;

-- Prohibited items: whole-word match against the job's free text.
create or replace function app.prohibited_hit(p_text text) returns text
language sql stable security definer set search_path = '' as $$
  select pi.term from public.prohibited_items pi
  where pi.active and p_text ~* ('\m' || regexp_replace(pi.term, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M')
  limit 1
$$;

-- ---------------------------------------------------------------- public API: quoting & ordering
-- C4: instant fixed quote. Customers see the lines; the cost side is stripped unless staff.
create or replace function public.quote_job(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q jsonb := app.price_request(p_input);
begin
  if not app.is_staff() and not app.is_service() then
    q := q - 'economics' - 'price_table_id';
  end if;
  return q - 'zone_ids';
end $$;

-- C2 / O4: create a job in Quoted state. Ops may create on a customer's behalf (WhatsApp intake).
create or replace function public.create_job(p_input jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  q jsonb;
  v_customer uuid;
  v_via text := 'app';
  v_task public.task_type := (p_input ->> 'task_type')::public.task_type;
  v_id uuid;
  hit text;
  s jsonb; i int := 0;
begin
  perform app.require(auth.uid() is not null or app.is_service(), 'AUTH_REQUIRED');
  if app.is_staff('agent', 'ops_lead', 'admin') and p_input ? 'customer_id' then
    v_customer := (p_input ->> 'customer_id')::uuid;
    v_via := 'ops_whatsapp';
  else
    v_customer := auth.uid();
  end if;
  perform app.require(exists (select 1 from public.profiles where id = v_customer), 'CUSTOMER_NOT_FOUND');

  hit := app.prohibited_hit(coalesce(p_input -> 'details', '{}'::jsonb)::text || ' ' || coalesce(p_input ->> 'note', ''));
  perform app.require(hit is null, 'PROHIBITED_ITEM', format('We can''t carry out requests involving "%s"', hit));

  q := app.price_request(p_input);

  insert into public.jobs (product, task_type, customer_id, recipient_name, recipient_phone, details,
                           item_size, item_value_kobo, item_budget_kobo, price_kobo, quote, price_table_id,
                           created_via, created_by, scheduled_for)
  values (case when v_task = 'send' then 'send'::public.product else 'run'::public.product end,
          v_task, v_customer,
          p_input ->> 'recipient_name', p_input ->> 'recipient_phone',
          coalesce(p_input -> 'details', '{}'::jsonb),
          (p_input ->> 'item_size')::public.item_size,
          coalesce((p_input ->> 'item_value_kobo')::bigint, 0),
          coalesce((p_input ->> 'item_budget_kobo')::bigint, 0),
          (q ->> 'price_kobo')::bigint,
          q - 'economics' - 'zone_ids' - 'price_table_id',
          (q ->> 'price_table_id')::uuid,
          v_via, auth.uid(), (p_input ->> 'scheduled_for')::timestamptz)
  returning id into v_id;

  insert into public.job_economics (job_id, price_table_version, price_kobo, runner_pay_kobo, payment_fee_kobo,
                                    ops_cost_kobo, contingency_kobo, contribution_kobo, contribution_rate, floor_applied)
  select v_id, (q ->> 'price_table_version')::int, (q ->> 'price_kobo')::bigint,
         (e ->> 'runner_pay_kobo')::bigint, (e ->> 'payment_fee_kobo')::bigint, (e ->> 'ops_cost_kobo')::bigint,
         (e ->> 'contingency_kobo')::bigint, (e ->> 'contribution_kobo')::bigint,
         (e ->> 'contribution_rate')::numeric, (e ->> 'floor_applied')::boolean
  from (select q -> 'economics' as e) x;

  for s in select * from jsonb_array_elements(p_input -> 'stops') loop
    i := i + 1;
    insert into public.job_stops (job_id, seq, kind, address, landmark, location, zone_id, contact_name, contact_phone, note)
    values (v_id, i, coalesce(s ->> 'kind', case when i = 1 then 'pickup' else 'dropoff' end),
            s ->> 'address', s ->> 'landmark',
            extensions.st_setsrid(extensions.st_makepoint((s ->> 'lng')::float8, (s ->> 'lat')::float8), 4326)::extensions.geography,
            ((q -> 'zone_ids') ->> (i - 1))::uuid,
            s ->> 'contact_name', s ->> 'contact_phone', s ->> 'note');
  end loop;

  insert into public.job_events (job_id, kind, to_status, actor_id, actor_role, data)
  values (v_id, 'transition', 'quoted', auth.uid(),
          case when v_via = 'ops_whatsapp' then 'ops'::public.actor_role else 'customer'::public.actor_role end,
          jsonb_build_object('created_via', v_via));
  return v_id;
end $$;

-- C3: outside an active zone → waitlist. Also used for companion-service demand.
create or replace function public.join_waitlist(p_phone text, p_reason text, p_name text default null,
                                                p_lat double precision default null, p_lng double precision default null,
                                                p_note text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.waitlist (phone, name, reason, location, note)
  values (p_phone, p_name, p_reason,
          case when p_lat is null then null
               else extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end,
          p_note)
$$;

-- Ops may change a price only before payment, with a reason (O3).
create or replace function public.ops_adjust_price(p_job uuid, p_price_kobo bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform app.require(app.is_staff('ops_lead', 'admin'), 'FORBIDDEN');
  perform app.require(nullif(trim(p_reason), '') is not null, 'REASON_REQUIRED');
  select * into j from public.jobs where id = p_job for update;
  perform app.require(j.status = 'quoted', 'PRICE_FROZEN', 'Only unpaid quotes can be re-priced');
  update public.jobs set price_kobo = p_price_kobo,
         quote = jsonb_set(quote, '{price_kobo}', to_jsonb(p_price_kobo)) || jsonb_build_object('adjusted', true),
         updated_at = now()
   where id = p_job;
  update public.job_economics e set
         price_kobo = p_price_kobo,
         contribution_kobo = p_price_kobo - (e.runner_pay_kobo + e.payment_fee_kobo + e.ops_cost_kobo + e.contingency_kobo),
         contribution_rate = round((p_price_kobo - (e.runner_pay_kobo + e.payment_fee_kobo + e.ops_cost_kobo + e.contingency_kobo))::numeric
                                   / nullif(p_price_kobo, 0), 4)
   where job_id = p_job;
  insert into public.job_events (job_id, kind, actor_id, actor_role, reason, data)
  values (p_job, 'price_adjust', auth.uid(), 'ops', p_reason,
          jsonb_build_object('from_kobo', j.price_kobo, 'to_kobo', p_price_kobo));
  perform app.audit('adjust_price', 'job', p_job::text, p_reason,
                    jsonb_build_object('price_kobo', j.price_kobo), jsonb_build_object('price_kobo', p_price_kobo), 'ops');
end $$;

-- ---------------------------------------------------------------- payments (C5)
-- The payment-initialise edge function stamps the Paystack reference on the job
-- before sending the customer to checkout. Prepaid before dispatch: nothing moves until confirm_payment.
create or replace function public.attach_payment_ref(p_job uuid, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(app.is_service(), 'FORBIDDEN');
  update public.jobs set payment_ref = p_reference, updated_at = now() where id = p_job and status = 'quoted';
  perform app.require(found, 'NOT_PAYABLE', 'Only a quoted job can be paid');
end $$;

-- Called by the Paystack webhook edge function with the service role, after it
-- verifies the signature. Idempotent: the same event or reference twice is a no-op.
create or replace function public.confirm_payment(p_event_id text, p_reference text, p_amount_kobo bigint, p_raw jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
  t public.price_tables;
  inserted int;
  first_time boolean;
  b bytea := extensions.gen_random_bytes(16);
begin
  perform app.require(app.is_service(), 'FORBIDDEN');
  insert into public.payment_events (provider_event_id) values (p_event_id)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  first_time := inserted = 1;

  select * into j from public.jobs where payment_ref = p_reference for update;
  perform app.require(found, 'JOB_NOT_FOUND', 'No job carries this payment reference');
  if not first_time or j.status <> 'quoted'
     or exists (select 1 from public.payments where provider_ref = p_reference and status = 'succeeded') then
    return j.id;  -- already handled
  end if;

  if p_amount_kobo <> j.price_kobo + j.item_budget_kobo then
    insert into public.payments (job_id, kind, provider_ref, amount_kobo, status, reason, raw)
    values (j.id, 'charge', p_reference, p_amount_kobo, 'amount_mismatch',
            format('expected %s', j.price_kobo + j.item_budget_kobo), p_raw);
    perform app.audit('payment_amount_mismatch', 'job', j.id::text, null, null,
                      jsonb_build_object('paid', p_amount_kobo, 'expected', j.price_kobo + j.item_budget_kobo), 'system');
    return j.id;
  end if;

  insert into public.payments (job_id, kind, provider_ref, amount_kobo, status, raw)
  values (j.id, 'charge', p_reference, p_amount_kobo, 'succeeded', p_raw);

  perform app.apply_transition(j.id, 'paid', 'system', 'payment confirmed', jsonb_build_object('reference', p_reference));

  select pt.* into t from public.price_tables pt where pt.id = j.price_table_id;
  update public.jobs set
    tracking_token = encode(extensions.gen_random_bytes(12), 'hex'),
    promised_by    = coalesce(scheduled_for, now()) + make_interval(mins => t.promise_window_minutes)
   where id = j.id;
  update public.job_economics set frozen_at = now() where job_id = j.id;
  insert into public.job_secrets (job_id, handover_otp)
  values (j.id, lpad(((get_byte(b, 0) * 256 + get_byte(b, 1)) % 10000)::text, 4, '0'));
  return j.id;
end $$;

-- ---------------------------------------------------------------- dispatch (R2, R3, O1, O3)
create or replace function public.set_online(p_online boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.runners;
begin
  select * into r from public.runners where user_id = auth.uid();
  perform app.require(found, 'NOT_A_RUNNER');
  perform app.require(not p_online or r.status = 'verified', 'NOT_VERIFIED', 'Only verified runners can go online');
  update public.runners set online = p_online, last_seen_at = now() where user_id = r.user_id;
end $$;

create or replace function app.runner_is_idle(p_runner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.jobs j
    where j.runner_id = p_runner
      and j.status in ('assigned', 'picked_up', 'on_the_way', 'customer_approval', 'needs_ops'))
$$;

-- System suggestion for ops: verified, online, idle, recently seen; nearest to the first stop.
create or replace function public.suggest_runners(p_job uuid, p_limit int default 5)
returns table (runner_id uuid, full_name text, vehicle public.vehicle, distance_m double precision, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require(app.is_staff() or app.is_service(), 'FORBIDDEN');
  return query
  select r.user_id, r.full_name, r.vehicle,
         extensions.st_distance(r.current_location, s.location),
         r.last_seen_at
  from public.runners r
  cross join (select location from public.job_stops where job_id = p_job and seq = 1) s
  where r.status = 'verified' and r.online
    and r.last_seen_at > now() - interval '3 minutes'
    and r.current_location is not null
    and app.runner_is_idle(r.user_id)
  order by extensions.st_distance(r.current_location, s.location)
  limit p_limit;
end $$;

-- Ops confirms a suggested runner: the runner gets an offer with a 45-second timer.
create or replace function public.offer_job(p_job uuid, p_runner uuid, p_seconds int default 45) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_offer uuid; v_pay bigint;
begin
  perform app.require(app.is_staff() or app.is_service(), 'FORBIDDEN');
  select * into j from public.jobs where id = p_job for update;
  perform app.require(j.status in ('paid', 'needs_ops'), 'NOT_DISPATCHABLE', format('Job is %s', j.status));
  perform app.require(exists (select 1 from public.runners r where r.user_id = p_runner and r.status = 'verified' and r.online),
                      'RUNNER_UNAVAILABLE');
  perform app.require(app.runner_is_idle(p_runner), 'RUNNER_BUSY');
  update public.offers set response = 'withdrawn', responded_at = now() where job_id = p_job and response = 'pending';
  select runner_pay_kobo into v_pay from public.job_economics where job_id = p_job;
  insert into public.offers (job_id, runner_id, earnings_kobo, offered_by, expires_at)
  values (p_job, p_runner, v_pay, auth.uid(), now() + make_interval(secs => p_seconds))
  returning id into v_offer;
  insert into public.job_events (job_id, kind, actor_id, actor_role, data)
  values (p_job, 'offer', auth.uid(), case when app.is_service() then 'system'::public.actor_role else 'ops'::public.actor_role end,
          jsonb_build_object('offer_id', v_offer, 'runner_id', p_runner));
  return v_offer;
end $$;

create or replace function public.respond_to_offer(p_offer uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.offers; j public.jobs;
begin
  select * into o from public.offers where id = p_offer for update;
  perform app.require(found and o.runner_id = auth.uid(), 'FORBIDDEN');
  perform app.require(o.response = 'pending', 'OFFER_CLOSED');
  if o.expires_at < now() then
    update public.offers set response = 'expired', responded_at = now() where id = p_offer;
    perform app.require(false, 'OFFER_EXPIRED');
  end if;
  if not p_accept then
    update public.offers set response = 'declined', responded_at = now() where id = p_offer;
    return;
  end if;

  perform app.require(exists (select 1 from public.runners r where r.user_id = auth.uid() and r.status = 'verified'), 'NOT_VERIFIED');
  perform app.require(app.runner_is_idle(auth.uid()), 'RUNNER_BUSY');
  select * into j from public.jobs where id = o.job_id for update;
  perform app.require(j.status in ('paid', 'needs_ops'), 'NOT_DISPATCHABLE');

  update public.offers set response = 'accepted', responded_at = now() where id = p_offer;
  update public.jobs set runner_id = auth.uid() where id = o.job_id;
  -- A runner accepting from needs_ops is ops' choice via the offer, so it is recorded as ops-sanctioned.
  perform app.apply_transition(o.job_id, 'assigned',
                               case when j.status = 'needs_ops' then 'ops'::public.actor_role else 'runner'::public.actor_role end,
                               'offer accepted', jsonb_build_object('offer_id', p_offer));
end $$;

-- Ops assigns or reassigns directly. Always needs a reason; always logged.
create or replace function public.ops_assign(p_job uuid, p_runner uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform app.require(app.is_staff('agent', 'ops_lead', 'admin'), 'FORBIDDEN');
  perform app.require(nullif(trim(p_reason), '') is not null, 'REASON_REQUIRED');
  perform app.require(exists (select 1 from public.runners r where r.user_id = p_runner and r.status = 'verified'), 'NOT_VERIFIED');
  perform app.require(app.runner_is_idle(p_runner), 'RUNNER_BUSY');
  select * into j from public.jobs where id = p_job for update;
  perform app.require(found, 'JOB_NOT_FOUND');

  if j.status in ('paid', 'needs_ops') then
    update public.jobs set runner_id = p_runner where id = p_job;
    if j.status = 'needs_ops' and j.previous_status is not null and j.previous_status <> 'paid' then
      perform app.apply_transition(p_job, j.previous_status, 'ops', p_reason, jsonb_build_object('runner_id', p_runner));
    else
      perform app.apply_transition(p_job, 'assigned', 'ops', p_reason, jsonb_build_object('runner_id', p_runner));
    end if;
  else
    perform app.require(j.status in ('assigned', 'picked_up', 'on_the_way', 'customer_approval'), 'NOT_REASSIGNABLE');
    update public.jobs set runner_id = p_runner, updated_at = now() where id = p_job;
    insert into public.job_events (job_id, kind, actor_id, actor_role, reason, data)
    values (p_job, 'assignment', auth.uid(), 'ops', p_reason,
            jsonb_build_object('from_runner', j.runner_id, 'to_runner', p_runner));
  end if;
  update public.offers set response = 'withdrawn', responded_at = now() where job_id = p_job and response = 'pending';
  perform app.audit(case when j.runner_id is null then 'assign' else 'reassign' end, 'job', p_job::text, p_reason,
                    jsonb_build_object('runner_id', j.runner_id), jsonb_build_object('runner_id', p_runner), 'ops');
end $$;

-- ---------------------------------------------------------------- running the job (R4, R6, R7)
-- Generic moves: picked_up, on_the_way, needs_ops, return from a holding state, failed.
-- Paid, assigned, customer_approval, completed and cancelled each have their own function.
create or replace function public.transition_job(p_job uuid, p_to public.job_status, p_reason text default null,
                                                 p_reason_code public.failure_reason default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.actor_role;
begin
  perform app.require(p_to in ('picked_up', 'on_the_way', 'needs_ops', 'failed', 'paid', 'assigned'),
                      'USE_DEDICATED_FUNCTION', format('Use the dedicated function to move a job to %s', p_to));
  select * into j from public.jobs where id = p_job;
  perform app.require(found, 'JOB_NOT_FOUND');
  r := app.actor_role_for(j);
  perform app.require(r is not null, 'FORBIDDEN');
  -- 'paid' / 'assigned' are only reachable here as a return from a holding state.
  perform app.require(p_to not in ('paid', 'assigned') or (j.status in ('needs_ops', 'customer_approval') and p_to = j.previous_status),
                      'USE_DEDICATED_FUNCTION');
  if p_to = 'failed' then
    perform app.require(p_reason_code is not null, 'REASON_REQUIRED');
  end if;
  if p_to = 'needs_ops' then
    perform app.require(nullif(trim(p_reason), '') is not null, 'REASON_REQUIRED');
  end if;
  perform app.apply_transition(p_job, p_to, r, p_reason,
                               case when p_reason_code is null then '{}'::jsonb
                                    else jsonb_build_object('reason_code', p_reason_code, 'note', p_reason) end);
  if r = 'ops' then
    perform app.audit('transition:' || p_to, 'job', p_job::text, p_reason, null, null, 'ops');
  end if;
end $$;

-- R7 / C7: runner raises a mid-job change; the job waits for the customer.
create or replace function public.raise_change(p_job uuid, p_kind public.change_kind, p_amount_kobo bigint, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.actor_role; v_id uuid;
begin
  select * into j from public.jobs where id = p_job;
  r := app.actor_role_for(j);
  perform app.require(r in ('runner', 'ops'), 'FORBIDDEN');
  perform app.require(nullif(trim(p_note), '') is not null, 'NOTE_REQUIRED');
  insert into public.change_requests (job_id, kind, amount_kobo, note, raised_by)
  values (p_job, p_kind, coalesce(p_amount_kobo, 0), p_note, auth.uid())
  returning id into v_id;
  perform app.apply_transition(p_job, 'customer_approval', r, p_note,
                               jsonb_build_object('change_id', v_id, 'kind', p_kind, 'amount_kobo', p_amount_kobo));
  return v_id;
end $$;

-- One tap for the customer. Approve → back to work. Decline → ops decides what happens next.
create or replace function public.decide_change(p_change uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.change_requests; j public.jobs; r public.actor_role;
begin
  select * into c from public.change_requests where id = p_change for update;
  perform app.require(found and c.status = 'pending', 'CHANGE_CLOSED');
  select * into j from public.jobs where id = c.job_id;
  r := app.actor_role_for(j);
  perform app.require(r in ('customer', 'ops'), 'FORBIDDEN');
  update public.change_requests
     set status = case when p_approve then 'approved'::public.change_status else 'declined'::public.change_status end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_change;
  insert into public.job_events (job_id, kind, actor_id, actor_role, data)
  values (c.job_id, 'change_decision', auth.uid(), r, jsonb_build_object('change_id', p_change, 'approved', p_approve));

  if p_approve then
    if c.amount_kobo > 0 then
      if c.kind = 'budget_topup' then
        update public.jobs set item_budget_kobo = item_budget_kobo + c.amount_kobo where id = c.job_id;
      else
        update public.jobs set extras_kobo = extras_kobo + c.amount_kobo where id = c.job_id;
      end if;
      -- The extra amount is collected before the runner spends it (collection handled by the payments function).
      insert into public.payments (job_id, kind, amount_kobo, status, reason, created_by)
      values (c.job_id, 'topup', c.amount_kobo, 'pending', c.kind::text || ': ' || c.note, auth.uid());
    end if;
    perform app.apply_transition(c.job_id, j.previous_status, r, 'change approved', jsonb_build_object('change_id', p_change));
  else
    perform app.apply_transition(c.job_id, 'needs_ops', r, 'change declined', jsonb_build_object('change_id', p_change));
  end if;
end $$;

create or replace function public.add_proof(p_job uuid, p_kind public.proof_kind, p_path text, p_stop_seq int default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.actor_role; v_id uuid;
begin
  select * into j from public.jobs where id = p_job;
  r := app.actor_role_for(j);
  perform app.require(r in ('runner', 'ops'), 'FORBIDDEN');
  perform app.require(j.status in ('assigned', 'picked_up', 'on_the_way', 'customer_approval', 'needs_ops'), 'JOB_NOT_ACTIVE');
  insert into public.proofs (job_id, stop_seq, kind, storage_path, created_by)
  values (p_job, p_stop_seq, p_kind, p_path, auth.uid()) returning id into v_id;
  insert into public.job_events (job_id, kind, actor_id, actor_role, data)
  values (p_job, 'proof', auth.uid(), r, jsonb_build_object('proof_id', v_id, 'kind', p_kind, 'stop_seq', p_stop_seq));
  return v_id;
end $$;

-- Proof rules per task type (PRD "Run (errands)" table).
create or replace function app.proof_satisfied(p_job public.jobs) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare n_stops int;
begin
  case p_job.task_type
    when 'buy_and_bring'   then return exists (select 1 from public.proofs where job_id = p_job.id and kind = 'receipt');
    when 'collect'         then return exists (select 1 from public.proofs where job_id = p_job.id and kind = 'photo');
    when 'send'            then return exists (select 1 from public.proofs where job_id = p_job.id and kind = 'photo');
    when 'drop_and_submit' then return exists (select 1 from public.proofs where job_id = p_job.id and kind in ('stamped_copy', 'photo'));
    when 'queue_and_wait'  then return exists (select 1 from public.proofs where job_id = p_job.id and kind = 'timestamped_photo');
    when 'multi_stop'      then
      select count(*) into n_stops from public.job_stops where job_id = p_job.id;
      return (select count(distinct stop_seq) from public.proofs where job_id = p_job.id and stop_seq is not null) >= n_stops;
  end case;
  return false;
end $$;

-- Tasks that end with a handover need the recipient's OTP.
create or replace function app.needs_otp(p_task public.task_type) returns boolean
language sql immutable as $$ select p_task in ('buy_and_bring', 'collect', 'multi_stop', 'send') $$;

create or replace function public.complete_job(p_job uuid, p_otp text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; e public.job_economics;
begin
  select * into j from public.jobs where id = p_job for update;
  perform app.require(found and j.runner_id = auth.uid(), 'FORBIDDEN');
  perform app.require(app.proof_satisfied(j), 'PROOF_REQUIRED', 'Upload the proof this task needs before completing');
  if app.needs_otp(j.task_type) then
    perform app.require(exists (select 1 from public.job_secrets s where s.job_id = p_job and s.handover_otp = p_otp),
                        'OTP_INVALID', 'The handover code does not match');
  end if;
  perform app.apply_transition(p_job, 'completed', 'runner', 'handover complete');
  select * into e from public.job_economics where job_id = p_job;
  insert into public.runner_earnings (job_id, runner_id, base_kobo) values (p_job, j.runner_id, e.runner_pay_kobo);
end $$;

-- ---------------------------------------------------------------- cancellations & refunds
-- Customer: free before assignment, 30% after assignment (before pickup). Later than that, ops handles it.
create or replace function public.cancel_job(p_job uuid, p_reason_code public.failure_reason, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.actor_role; t public.price_tables; fee bigint; paid bigint; refund bigint;
begin
  select * into j from public.jobs where id = p_job for update;
  perform app.require(found, 'JOB_NOT_FOUND');
  r := app.actor_role_for(j);
  perform app.require(r in ('customer', 'ops'), 'FORBIDDEN');
  perform app.require(r = 'ops' or j.status in ('quoted', 'paid', 'assigned', 'customer_approval'), 'CONTACT_SUPPORT',
                      'Once your runner has picked up, contact support to cancel');
  select pt.* into t from public.price_tables pt where pt.id = j.price_table_id;

  fee := case
           when j.status in ('quoted', 'paid') then 0
           when j.status = 'assigned' then round(j.price_kobo * t.cancel_fee_rate, -2)::bigint
           when j.status = 'customer_approval' and j.previous_status = 'assigned' then round(j.price_kobo * t.cancel_fee_rate, -2)::bigint
           else j.price_kobo
         end;
  update public.jobs set cancellation_fee_kobo = fee where id = p_job;
  perform app.apply_transition(p_job, 'cancelled', r, p_note, jsonb_build_object('reason_code', p_reason_code, 'note', p_note));

  -- Refund what was paid minus the fee. After pickup, money already spent on items is settled by ops.
  select coalesce(sum(amount_kobo), 0) into paid from public.payments
   where job_id = p_job and kind in ('charge', 'topup') and status = 'succeeded';
  refund := case when j.status in ('quoted', 'paid', 'assigned', 'customer_approval') then paid - fee else 0 end;
  if refund > 0 then
    insert into public.payments (job_id, kind, amount_kobo, status, reason, created_by)
    values (p_job, 'refund', refund, 'pending', 'cancellation', auth.uid());
  end if;
  if r = 'ops' then
    perform app.audit('cancel', 'job', p_job::text, coalesce(p_note, p_reason_code::text), null,
                      jsonb_build_object('fee_kobo', fee, 'refund_kobo', refund), 'ops');
  end if;
end $$;

create or replace function public.issue_refund(p_job uuid, p_amount_kobo bigint, p_reason text, p_to_wallet boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs;
begin
  perform app.require(app.is_staff('ops_lead', 'finance', 'admin'), 'FORBIDDEN');
  perform app.require(nullif(trim(p_reason), '') is not null, 'REASON_REQUIRED');
  perform app.require(p_amount_kobo > 0, 'AMOUNT_INVALID');
  select * into j from public.jobs where id = p_job;
  if p_to_wallet then
    insert into public.wallet_entries (customer_id, job_id, amount_kobo, reason, created_by)
    values (j.customer_id, p_job, p_amount_kobo, p_reason, auth.uid());
  else
    insert into public.payments (job_id, kind, amount_kobo, status, reason, created_by)
    values (p_job, 'refund', p_amount_kobo, 'pending', p_reason, auth.uid());
  end if;
  perform app.audit('refund', 'job', p_job::text, p_reason, null,
                    jsonb_build_object('amount_kobo', p_amount_kobo, 'to_wallet', p_to_wallet), 'ops');
end $$;

-- Buying errands: the float is sent to the runner when they reach the store.
create or replace function public.record_float(p_job uuid, p_amount_kobo bigint, p_transfer_ref text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; v_id uuid;
begin
  perform app.require(app.is_staff('agent', 'ops_lead', 'finance', 'admin') or app.is_service(), 'FORBIDDEN');
  select * into j from public.jobs where id = p_job;
  perform app.require(j.runner_id is not null, 'NO_RUNNER');
  perform app.require(p_amount_kobo <= j.item_budget_kobo, 'FLOAT_OVER_BUDGET');
  insert into public.job_floats (job_id, runner_id, amount_kobo, transfer_ref, status, sent_by)
  values (p_job, j.runner_id, p_amount_kobo, p_transfer_ref, 'sent', auth.uid()) returning id into v_id;
  perform app.audit('send_float', 'job', p_job::text, null, null, jsonb_build_object('amount_kobo', p_amount_kobo), 'ops');
  return v_id;
end $$;

-- ---------------------------------------------------------------- tracking (R5, C6)
-- Points arrive every 15 seconds, or in a batch after the phone was offline.
-- p_points: [{"lat":6.5,"lng":3.37,"at":"2026-10-26T10:00:00Z","acc":12}, ...]
create or replace function public.record_locations(p_job uuid, p_points jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; n int; latest jsonb;
begin
  select * into j from public.jobs where id = p_job;
  perform app.require(found and j.runner_id = auth.uid(), 'FORBIDDEN');
  -- Location is recorded only while a runner is on a job.
  perform app.require(j.status in ('assigned', 'picked_up', 'on_the_way', 'customer_approval', 'needs_ops'), 'JOB_NOT_ACTIVE');
  insert into public.location_events (runner_id, job_id, location, accuracy_m, recorded_at)
  select auth.uid(), p_job,
         extensions.st_setsrid(extensions.st_makepoint((p ->> 'lng')::float8, (p ->> 'lat')::float8), 4326)::extensions.geography,
         (p ->> 'acc')::real, (p ->> 'at')::timestamptz
  from jsonb_array_elements(p_points) p;
  get diagnostics n = row_count;
  select p into latest from jsonb_array_elements(p_points) p order by (p ->> 'at')::timestamptz desc limit 1;
  if latest is not null then
    update public.runners set
      current_location = extensions.st_setsrid(extensions.st_makepoint((latest ->> 'lng')::float8, (latest ->> 'lat')::float8), 4326)::extensions.geography,
      last_seen_at = now()
    where user_id = auth.uid();
  end if;
  return n;
end $$;

-- Shareable tracking link for the recipient (anonymous). Shows only what tracking needs.
create or replace function public.get_tracking(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ref', j.ref,
    'status', j.status,
    'promised_by', j.promised_by,
    'runner', case when r.user_id is null then null else jsonb_build_object(
                'first_name', split_part(r.full_name, ' ', 1), 'vehicle', r.vehicle, 'plate', r.plate, 'photo_path', r.photo_path) end,
    'position', case when j.status in ('assigned', 'picked_up', 'on_the_way') and r.current_location is not null
                     then jsonb_build_object('lat', extensions.st_y(r.current_location::extensions.geometry),
                                             'lng', extensions.st_x(r.current_location::extensions.geometry),
                                             'at', r.last_seen_at) end,
    'dropoff', (select jsonb_build_object('address', s.address, 'landmark', s.landmark)
                  from public.job_stops s where s.job_id = j.id order by s.seq desc limit 1),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('status', e.to_status, 'at', e.created_at) order by e.id), '[]'::jsonb)
                   from public.job_events e where e.job_id = j.id and e.kind = 'transition')
  )
  from public.jobs j
  left join public.runners r on r.user_id = j.runner_id
  where j.tracking_token = p_token
$$;

-- Emergency button for runners and customers: alerts ops immediately.
create or replace function public.raise_emergency(p_job uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; r public.actor_role;
begin
  select * into j from public.jobs where id = p_job;
  r := app.actor_role_for(j);
  perform app.require(r in ('customer', 'runner'), 'FORBIDDEN');
  insert into public.job_events (job_id, kind, actor_id, actor_role, reason)
  values (p_job, 'emergency', auth.uid(), r, p_note);
  perform app.audit('emergency', 'job', p_job::text, p_note, null, null, r);
end $$;

-- ---------------------------------------------------------------- ops tools (O5, O6, O7)
create or replace function public.ops_set_runner_status(p_runner uuid, p_status public.runner_status, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare old public.runners;
begin
  perform app.require(app.is_staff('ops_lead', 'admin'), 'FORBIDDEN');
  perform app.require(nullif(trim(p_note), '') is not null, 'REASON_REQUIRED');
  select * into old from public.runners where user_id = p_runner for update;
  perform app.require(found, 'NOT_A_RUNNER');
  update public.runners set
    status = p_status, status_note = p_note,
    online = case when p_status = 'verified' then online else false end,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    verified_by = case when p_status = 'verified' then auth.uid() else verified_by end
  where user_id = p_runner;
  perform app.audit('runner_status', 'runner', p_runner::text, p_note,
                    jsonb_build_object('status', old.status), jsonb_build_object('status', p_status), 'ops');
end $$;

create or replace function public.activate_price_table(p_table uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare prev uuid;
begin
  perform app.require(app.is_staff('ops_lead', 'admin'), 'FORBIDDEN');
  perform app.require(nullif(trim(p_reason), '') is not null, 'REASON_REQUIRED');
  select id into prev from public.price_tables where status = 'active';
  perform set_config('app.price_status_change', 'on', true);
  update public.price_tables set status = 'retired' where id = prev;
  update public.price_tables set status = 'active', activated_at = now() where id = p_table and status = 'draft';
  perform app.require(found, 'NOT_A_DRAFT', 'Only a draft price table can be activated');
  perform set_config('app.price_status_change', 'off', true);
  perform app.audit('activate_price_table', 'price_table', p_table::text, p_reason,
                    jsonb_build_object('previous', prev), jsonb_build_object('active', p_table), 'ops');
end $$;

-- A price table is editable only while it is a draft; once active, every job that used it can rely on it.
create or replace function app.guard_price_tables() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'PRICE_TABLE_LOCKED'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status and coalesce(current_setting('app.price_status_change', true), 'off') <> 'on' then
      raise exception 'PRICE_TABLE_LOCKED' using detail = 'Use activate_price_table to change status';
    end if;
    if old.status <> 'draft'
       and (to_jsonb(new) - 'status' - 'activated_at' - 'note') is distinct from (to_jsonb(old) - 'status' - 'activated_at' - 'note') then
      raise exception 'PRICE_TABLE_LOCKED' using detail = 'Copy this table into a new draft version to change prices';
    end if;
  end if;
  if tg_op = 'INSERT' and new.status <> 'draft' and coalesce(current_setting('app.price_status_change', true), 'off') <> 'on'
     and exists (select 1 from public.price_tables) then
    raise exception 'PRICE_TABLE_LOCKED' using detail = 'New price tables start as drafts';
  end if;
  return new;
end $$;
create trigger price_tables_guard before insert or update or delete on public.price_tables
  for each row execute function app.guard_price_tables();

create or replace function app.guard_price_lines() returns trigger
language plpgsql as $$
declare v_table uuid := case when tg_op = 'DELETE' then old.price_table_id else new.price_table_id end;
begin
  if (select status from public.price_tables where id = v_table) <> 'draft' then
    raise exception 'PRICE_TABLE_LOCKED' using detail = 'Fares belong to a published price table';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger zone_fares_guard before insert or update or delete on public.zone_fares for each row execute function app.guard_price_lines();
create trigger task_fees_guard  before insert or update or delete on public.task_fees  for each row execute function app.guard_price_lines();
create trigger size_fees_guard  before insert or update or delete on public.size_fees  for each row execute function app.guard_price_lines();

-- Copy a price table into a new draft version for editing.
create or replace function public.draft_price_table_from(p_table uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_new uuid; v_version int;
begin
  perform app.require(app.is_staff('ops_lead', 'admin'), 'FORBIDDEN');
  select coalesce(max(version), 0) + 1 into v_version from public.price_tables;
  insert into public.price_tables
  select (jsonb_populate_record(null::public.price_tables,
            to_jsonb(pt) || jsonb_build_object('id', gen_random_uuid(), 'version', v_version, 'status', 'draft',
                                               'note', p_note, 'created_by', auth.uid(), 'created_at', now(),
                                               'activated_at', null))).*
  from public.price_tables pt where pt.id = p_table
  returning id into v_new;
  insert into public.zone_fares select v_new, from_zone_id, to_zone_id, fare_kobo from public.zone_fares where price_table_id = p_table;
  insert into public.task_fees  select v_new, task_type, fee_kobo from public.task_fees where price_table_id = p_table;
  insert into public.size_fees  select v_new, size, fee_kobo from public.size_fees where price_table_id = p_table;
  return v_new;
end $$;

-- Zones are data: switching a zone on or off is an ops action (O6), and it is audited.
create or replace function app.audit_zones() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.audit(lower(tg_op), 'zone', coalesce(new.id, old.id)::text, null,
                    case when tg_op <> 'INSERT' then jsonb_build_object('active', old.active, 'name', old.name) end,
                    case when tg_op <> 'DELETE' then jsonb_build_object('active', new.active, 'name', new.name) end);
  return coalesce(new, old);
end $$;
create trigger zones_audit after insert or update or delete on public.zones
  for each row execute function app.audit_zones();

create or replace function app.audit_prohibited() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.audit(lower(tg_op), 'prohibited_item', coalesce(new.id, old.id)::text, null,
                    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger prohibited_audit after insert or update or delete on public.prohibited_items
  for each row execute function app.audit_prohibited();

-- ---------------------------------------------------------------- time rules (O1)
-- No runner in 5 minutes, no movement in 15, past the promised window, approval waiting, emergency.
create or replace function public.ops_alerts()
returns table (job_id uuid, ref text, status public.job_status, alert text, since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require(app.is_staff() or app.is_service(), 'FORBIDDEN');
  return query
  select j.id, j.ref, j.status, 'no_runner_5m', j.paid_at
    from public.jobs j where j.status = 'paid' and j.paid_at < now() - interval '5 minutes'
  union all
  select j.id, j.ref, j.status, 'no_movement_15m',
         coalesce((select max(l.recorded_at) from public.location_events l where l.job_id = j.id), j.assigned_at)
    from public.jobs j
   where j.status in ('assigned', 'picked_up', 'on_the_way')
     and coalesce((select max(l.recorded_at) from public.location_events l where l.job_id = j.id), j.assigned_at)
         < now() - interval '15 minutes'
  union all
  select j.id, j.ref, j.status, 'past_window', j.promised_by
    from public.jobs j
   where j.promised_by < now() and j.status not in ('quoted', 'completed', 'cancelled', 'failed')
  union all
  select j.id, j.ref, j.status, 'approval_waiting', c.created_at
    from public.jobs j join public.change_requests c on c.job_id = j.id and c.status = 'pending'
   where c.created_at < now() - interval '5 minutes'
  union all
  select j.id, j.ref, j.status, 'emergency', e.created_at
    from public.jobs j join public.job_events e on e.job_id = j.id and e.kind = 'emergency'
   where e.created_at > now() - interval '2 hours' and j.status not in ('completed', 'cancelled', 'failed')
  union all
  select j.id, j.ref, j.status, 'needs_ops', j.updated_at
    from public.jobs j where j.status = 'needs_ops';
end $$;

-- Run every minute: expire stale offers; paid jobs with no runner after 5 minutes go to ops.
create or replace function app.enforce_time_rules() returns int
language plpgsql security definer set search_path = '' as $$
declare j record; n int := 0;
begin
  update public.offers set response = 'expired', responded_at = now()
   where response = 'pending' and expires_at < now();
  for j in select id from public.jobs where status = 'paid' and paid_at < now() - interval '5 minutes' for update skip locked loop
    perform app.apply_transition(j.id, 'needs_ops', 'system', 'no runner within 5 minutes');
    n := n + 1;
  end loop;
  return n;
end $$;

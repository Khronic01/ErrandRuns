-- Order engine scenarios. Runs as a superuser and switches identity per step, like real API calls.
-- Fails loudly on the first broken rule.
\set QUIET on
create schema if not exists tests;

create or replace function tests.act(p_who text) returns void language plpgsql as $$
declare v_id uuid;
begin
  execute 'reset role';
  if p_who = 'postgres' then
    perform set_config('request.jwt.claims', '', false);
  elsif p_who = 'service' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
    execute 'set role service_role';
  elsif p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', false);
    execute 'set role anon';
  else
    select id into v_id from tests.users where name = p_who;
    if v_id is null then raise exception 'unknown test user %', p_who; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, false);
    execute 'set role authenticated';
  end if;
end $$;

create or replace function tests.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED % but statement succeeded: %', p_code, p_sql;
exception when others then
  if sqlerrm not like '%' || p_code || '%' then
    raise exception 'EXPECTED % but got "%": %', p_code, sqlerrm, p_sql;
  end if;
end $$;

create or replace function tests.eq(p_got anyelement, p_want anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL %: got %, want %', p_msg, p_got, p_want;
  end if;
  raise notice 'ok  %', p_msg;
end $$;

create table tests.users (name text primary key, id uuid not null default gen_random_uuid());
create table tests.vars (k text primary key, v text);
grant usage on schema tests to anon, authenticated, service_role;
grant all on all tables in schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;
create or replace function tests.v(p_k text) returns uuid language sql stable as $$ select v::uuid from tests.vars where k = p_k $$;
create or replace function tests.u(p_k text) returns uuid language sql stable as $$ select id from tests.users where name = p_k $$;
grant execute on function tests.v(text), tests.u(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures
insert into tests.users (name) values ('tola'), ('chidi'), ('stranger'), ('runner_a'), ('runner_b'),
                                      ('agent'), ('lead'), ('finance');
insert into auth.users (id, phone) select id, '+23480' || lpad((row_number() over ())::text, 8, '0') from tests.users;
insert into public.profiles (id, phone, full_name)
  select u.id, a.phone, initcap(u.name) from tests.users u join auth.users a using (id)
  where u.name in ('tola', 'chidi', 'stranger');
insert into public.staff (user_id, role) values
  (tests.u('agent'), 'agent'), (tests.u('lead'), 'ops_lead'), (tests.u('finance'), 'finance');
insert into public.runners (user_id, full_name, phone, plate, status, online, last_seen_at, current_location) values
  (tests.u('runner_a'), 'Emeka Runner', '+2348100000001', 'LAG-123-AB', 'verified', true, now(),
     extensions.st_setsrid(extensions.st_makepoint(3.378, 6.508), 4326)::extensions.geography),   -- Yaba, close to the store
  (tests.u('runner_b'), 'Bisi Runner',  '+2348100000002', 'LAG-456-CD', 'verified', true, now(),
     extensions.st_setsrid(extensions.st_makepoint(3.345, 6.50), 4326)::extensions.geography);    -- Surulere, farther

-- ---------------------------------------------------------------- 1. pricing
-- PRD worked example: Buy & bring, Yaba → Surulere, one extra stop, off-peak (Sunday), budget excluded.
do $$
declare q jsonb; e jsonb;
begin
  q := app.compute_quote(app.active_price_table(), 'buy_and_bring',
         app.zone_at(6.51, 3.38), app.zone_at(6.50, 3.35), 1, null, '2026-11-01 11:00+01', 0);
  e := q -> 'economics';
  perform tests.eq((q ->> 'price_kobo')::bigint, 400000::bigint, 'worked example: customer pays ₦4,000');
  perform tests.eq((e ->> 'runner_pay_kobo')::bigint, 220000::bigint, 'worked example: runner pay ₦2,200 (55%)');
  perform tests.eq((e ->> 'payment_fee_kobo')::bigint, 16000::bigint, 'worked example: payment fee ₦160');
  perform tests.eq((e ->> 'contingency_kobo')::bigint, 20000::bigint, 'worked example: contingency ₦200');
  perform tests.eq((e ->> 'contribution_kobo')::bigint, 104000::bigint, 'worked example: contribution ₦1,040');
  perform tests.eq((e ->> 'contribution_rate')::numeric, 0.26, 'worked example: 26% contribution');
  perform tests.eq(jsonb_array_length(q -> 'lines'), 3, 'worked example: fare + task fee + extra stop lines');

  q := app.compute_quote(app.active_price_table(), 'buy_and_bring',
         app.zone_at(6.51, 3.38), app.zone_at(6.50, 3.35), 1, null, '2026-11-02 08:15+01', 0);  -- Monday rush hour
  perform tests.eq((q ->> 'price_kobo')::bigint, 450000::bigint, 'peak surcharge adds ₦500 on a weekday morning');

  -- A cheap same-zone envelope cannot clear 20% at ₦1,500, so the floor raises it.
  q := app.compute_quote(app.active_price_table(), 'send',
         app.zone_at(6.51, 3.38), app.zone_at(6.51, 3.37), 0, 'envelope', '2026-11-01 11:00+01', 0);
  e := q -> 'economics';
  perform tests.eq((e ->> 'floor_applied')::boolean, true, 'margin floor raises an underpriced quote');
  perform tests.eq((e ->> 'contribution_rate')::numeric >= 0.20, true, 'raised quote clears the 20% floor');
  perform tests.eq((select sum((l ->> 'amount_kobo')::bigint) from jsonb_array_elements(q -> 'lines') l)::bigint,
                   (q ->> 'price_kobo')::bigint, 'customer lines always add up to the price');
  raise notice 'info: same-zone envelope priced at ₦%', (q ->> 'price_kobo')::bigint / 100;
end $$;

select tests.act('tola');
select tests.eq((public.quote_job('{"task_type":"send","item_size":"small_bag",
                  "stops":[{"lat":6.51,"lng":3.38},{"lat":6.50,"lng":3.35}]}') ? 'economics'), false,
                'customers never see the cost side of a quote');
select tests.expect_error($q$select public.quote_job('{"task_type":"send","stops":[{"lat":6.51,"lng":3.38},{"lat":6.45,"lng":3.60}]}')$q$,
                          'OUTSIDE_ZONE');
select tests.expect_error($q$select public.create_job('{"task_type":"collect","details":{"what":"pick up my gun from the repairer"},
                          "stops":[{"lat":6.51,"lng":3.38,"address":"a"},{"lat":6.50,"lng":3.35,"address":"b"}]}')$q$,
                          'PROHIBITED_ITEM');
select tests.expect_error($q$select public.create_job('{"task_type":"buy_and_bring","item_budget_kobo":15000000,
                          "stops":[{"lat":6.51,"lng":3.38,"address":"a"},{"lat":6.50,"lng":3.35,"address":"b"}]}')$q$,
                          'ITEM_VALUE_CAP');
select tests.expect_error($q$select public.create_job('{"task_type":"send",
                          "stops":[{"lat":6.51,"lng":3.38,"address":"a"}]}')$q$, 'STOPS_INVALID');

-- ---------------------------------------------------------------- 2. order → paid
select tests.act('tola');
insert into tests.vars select 'job1', public.create_job('{
  "task_type": "buy_and_bring", "item_budget_kobo": 500000,
  "recipient_name": "Mama Tola", "recipient_phone": "+2348099999999",
  "details": {"shopping_list": ["Peak milk 3-pack", "Bread"], "substitution": "ask me"},
  "stops": [
    {"lat": 6.509, "lng": 3.379, "address": "Shoprite, Yaba", "kind": "store"},
    {"lat": 6.500, "lng": 3.350, "address": "12 Adeniran Ogunsanya, Surulere", "landmark": "opposite the bank"}]}')::text;
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'quoted'::public.job_status, 'new job starts Quoted');
select tests.eq((select count(*) from public.job_economics), 0::bigint, 'customer cannot read job economics');
select tests.expect_error($q$update public.jobs set status = 'paid' where id = tests.v('job1')$q$, 'permission denied');

select tests.act('stranger');
select tests.eq((select count(*) from public.jobs where id = tests.v('job1')), 0::bigint, 'a stranger cannot see the job');

select tests.act('postgres');
select tests.expect_error($q$update public.jobs set status = 'completed' where id = tests.v('job1')$q$, 'STATUS_WRITE_FORBIDDEN');

select tests.act('tola');
select tests.expect_error($q$select public.confirm_payment('evt', 'ref', 1, null)$q$, 'permission denied');

select tests.act('service');
select public.attach_payment_ref(tests.v('job1'), 'PSK-job1');
-- Short payment: recorded, but the job does not move.
select public.confirm_payment('evt-short', 'PSK-job1', 100, null);
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'quoted'::public.job_status, 'short payment does not pay the job');
select tests.act('postgres');
delete from public.payments where provider_ref = 'PSK-job1';
select tests.act('service');
select public.confirm_payment('evt-1', 'PSK-job1', (select price_kobo + item_budget_kobo from public.jobs where id = tests.v('job1')), '{}');
select public.confirm_payment('evt-1', 'PSK-job1', (select price_kobo + item_budget_kobo from public.jobs where id = tests.v('job1')), '{}');
select public.confirm_payment('evt-2', 'PSK-job1', (select price_kobo + item_budget_kobo from public.jobs where id = tests.v('job1')), '{}');
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'paid'::public.job_status, 'payment moves the job to Paid');
select tests.eq((select count(*) from public.payments where job_id = tests.v('job1') and status = 'succeeded'), 1::bigint,
                'webhook delivered three times still makes one payment');
select tests.eq((select count(*) from public.job_events where job_id = tests.v('job1') and to_status = 'paid'), 1::bigint,
                'and one Paid event');
select tests.eq((select frozen_at is not null from public.job_economics where job_id = tests.v('job1')), true, 'economics frozen at payment');

-- ---------------------------------------------------------------- 3. dispatch
select tests.act('tola');
select tests.expect_error($q$select * from public.suggest_runners(tests.v('job1'))$q$, 'FORBIDDEN');
select tests.act('agent');
select tests.eq((select runner_id from public.suggest_runners(tests.v('job1')) limit 1), tests.u('runner_a'),
                'nearest idle verified runner is suggested first');
insert into tests.vars select 'offer1', public.offer_job(tests.v('job1'), tests.u('runner_a'))::text;

select tests.act('runner_a');
select tests.eq((select count(*) from public.jobs where id = tests.v('job1')), 1::bigint, 'runner sees the job they are offered');
select tests.eq((select count(*) from public.job_secrets), 0::bigint, 'runner can never read the handover code');
select tests.act('runner_b');
select tests.expect_error($q$select public.respond_to_offer(tests.v('offer1'), true)$q$, 'FORBIDDEN');
select tests.act('runner_a');
select public.respond_to_offer(tests.v('offer1'), true);
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'assigned'::public.job_status, 'accepting the offer assigns the job');
select tests.eq((select count(*) from public.job_economics), 0::bigint, 'runner cannot read job economics either');
select tests.act('postgres');
select tests.eq((select earnings_kobo from public.offers where id = tests.v('offer1')),
                (select runner_pay_kobo from public.job_economics where job_id = tests.v('job1')), 'offer shows the runner''s earnings');

-- ---------------------------------------------------------------- 4. doing the job
select tests.act('runner_a');
select tests.expect_error($q$select public.complete_job(tests.v('job1'), '0000')$q$, 'PROOF_REQUIRED');
select public.record_locations(tests.v('job1'),
  '[{"lat":6.507,"lng":3.377,"at":"2026-10-26T10:00:00Z"},{"lat":6.509,"lng":3.379,"at":"2026-10-26T10:00:15Z"}]');
select public.transition_job(tests.v('job1'), 'picked_up');

select tests.act('tola');
select tests.expect_error($q$select public.transition_job(tests.v('job1'), 'on_the_way')$q$, 'TRANSITION_NOT_ALLOWED');

-- Milk costs more than the budget: runner asks, customer approves in one tap.
select tests.act('runner_a');
insert into tests.vars select 'chg1', public.raise_change(tests.v('job1'), 'budget_topup', 50000, 'Milk is ₦500 more than budgeted')::text;
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'customer_approval'::public.job_status, 'change puts the job on hold for the customer');
select tests.act('tola');
select public.decide_change(tests.v('chg1'), true);
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'picked_up'::public.job_status, 'approval returns the job to where it was');
select tests.eq((select item_budget_kobo from public.jobs where id = tests.v('job1')), 550000::bigint, 'approved top-up raises the budget');
select tests.eq((select count(*) from public.payments where job_id = tests.v('job1') and kind = 'topup' and status = 'pending'), 1::bigint,
                'top-up is queued for collection');

select tests.act('runner_a');
select public.transition_job(tests.v('job1'), 'on_the_way');
select public.add_proof(tests.v('job1'), 'receipt', tests.v('job1')::text || '/receipt.jpg', 1);
select tests.expect_error($q$select public.complete_job(tests.v('job1'), 'nope')$q$, 'OTP_INVALID');

select tests.act('tola');
insert into tests.vars select 'otp1', handover_otp from public.job_secrets where job_id = tests.v('job1');
select tests.eq((select length(v) from tests.vars where k = 'otp1'), 4, 'customer can read the 4-digit handover code');

select tests.act('runner_a');
select public.complete_job(tests.v('job1'), (select v from tests.vars where k = 'otp1'));
select tests.eq((select status from public.jobs where id = tests.v('job1')), 'completed'::public.job_status, 'proof + OTP completes the job');
select tests.eq((select base_kobo from public.runner_earnings where job_id = tests.v('job1')),
                (select earnings_kobo from public.offers where id = tests.v('offer1')), 'runner earns what the offer showed');
select tests.expect_error($q$select public.transition_job(tests.v('job1'), 'on_the_way')$q$, 'JOB_CLOSED');
select tests.expect_error($q$select public.record_locations(tests.v('job1'), '[{"lat":6.5,"lng":3.35,"at":"2026-10-26T11:00:00Z"}]')$q$,
                          'JOB_NOT_ACTIVE');

select tests.act('anon');
select tests.expect_error($q$select tracking_token from public.jobs$q$, 'permission denied');
select tests.eq(public.get_tracking('not-a-real-token'), null::jsonb, 'a guessed token reveals nothing');
select tests.act('tola');
insert into tests.vars select 'tok1', tracking_token from public.jobs where id = tests.v('job1');
select tests.act('anon');
select tests.eq(public.get_tracking((select v from tests.vars where k = 'tok1')) ->> 'status', 'completed',
                'recipient tracking link works without logging in');
select tests.eq((public.get_tracking((select v from tests.vars where k = 'tok1')) -> 'runner') ? 'phone', false,
                'tracking link never exposes phone numbers');

-- ---------------------------------------------------------------- 5. cancellation after assignment
select tests.act('chidi');
insert into tests.vars select 'job2', public.create_job('{"task_type":"send","item_size":"small_bag",
  "recipient_name":"Buyer","recipient_phone":"+2348011111111",
  "stops":[{"lat":6.50,"lng":3.35,"address":"Chidi store, Surulere"},{"lat":6.51,"lng":3.38,"address":"Buyer, Yaba"}]}')::text;
select tests.act('service');
select public.attach_payment_ref(tests.v('job2'), 'PSK-job2');
select public.confirm_payment('evt-3', 'PSK-job2', (select price_kobo from public.jobs where id = tests.v('job2')), '{}');
select tests.act('agent');
select tests.expect_error($q$select public.ops_assign(tests.v('job2'), tests.u('runner_b'), '')$q$, 'REASON_REQUIRED');
select public.ops_assign(tests.v('job2'), tests.u('runner_b'), 'Bisi is already at the store');
select tests.act('chidi');
select public.cancel_job(tests.v('job2'), 'other', 'Buyer cancelled');
select tests.act('postgres');
select tests.eq((select cancellation_fee_kobo from public.jobs where id = tests.v('job2')),
                round((select price_kobo from public.jobs where id = tests.v('job2')) * 0.30, -2)::bigint,
                'cancelling after assignment costs 30%');
select tests.eq((select amount_kobo from public.payments where job_id = tests.v('job2') and kind = 'refund'),
                (select price_kobo - cancellation_fee_kobo from public.jobs where id = tests.v('job2')),
                'the rest is refunded');
select tests.eq((select count(*) from public.audit_log where entity_id = tests.v('job2')::text and action = 'assign'), 1::bigint,
                'ops assignment is in the audit log');

-- ---------------------------------------------------------------- 6. time rules and the ops queue
select tests.act('tola');
insert into tests.vars select 'job3', public.create_job('{"task_type":"queue_and_wait","details":{"max_wait_minutes":90},
  "stops":[{"lat":6.51,"lng":3.38,"address":"GTBank, Herbert Macaulay Way"}]}')::text;
select tests.act('service');
select public.attach_payment_ref(tests.v('job3'), 'PSK-job3');
select public.confirm_payment('evt-4', 'PSK-job3', (select price_kobo from public.jobs where id = tests.v('job3')), '{}');
select tests.act('postgres');
select set_config('app.in_transition', 'on', false);
update public.jobs set paid_at = now() - interval '6 minutes' where id = tests.v('job3');
select set_config('app.in_transition', 'off', false);
select tests.eq(app.enforce_time_rules(), 1, 'no runner in 5 minutes sends exactly one job to ops');
select tests.eq((select status from public.jobs where id = tests.v('job3')), 'needs_ops'::public.job_status, 'job is now in Needs ops');
select tests.act('agent');
select tests.eq((select count(*) from public.ops_alerts() where job_id = tests.v('job3')) >= 1, true, 'it shows on the ops alerts');
select public.ops_assign(tests.v('job3'), tests.u('runner_b'), 'Assigned by phone after no-runner alert');
select tests.eq((select status from public.jobs where id = tests.v('job3')), 'assigned'::public.job_status, 'ops assignment clears the hold');

-- Declined change goes to ops rather than silently stalling.
select tests.act('runner_b');
insert into tests.vars select 'chg2', public.raise_change(tests.v('job3'), 'extra_wait', 50000, 'Queue is long, 30 more minutes')::text;
select tests.act('tola');
select public.decide_change(tests.v('chg2'), false);
select tests.eq((select status from public.jobs where id = tests.v('job3')), 'needs_ops'::public.job_status, 'declined change goes to ops');
select tests.act('agent');
select public.transition_job(tests.v('job3'), 'assigned', 'Customer agreed to wait 15 more minutes by phone');
select tests.eq((select status from public.jobs where id = tests.v('job3')), 'assigned'::public.job_status, 'ops returns the job to work');

-- ---------------------------------------------------------------- 7. versioned prices
select tests.act('lead');
select tests.expect_error($q$update public.zone_fares set fare_kobo = 1 where price_table_id = (select id from public.price_tables where version = 1)$q$,
                          'PRICE_TABLE_LOCKED');
insert into tests.vars select 'pt2', public.draft_price_table_from((select id from public.price_tables where version = 1), 'Raise Yaba-Surulere')::text;
update public.zone_fares f set fare_kobo = 300000
 where f.price_table_id = tests.v('pt2')
   and f.from_zone_id = (select id from public.zones where slug = 'yaba')
   and f.to_zone_id = (select id from public.zones where slug = 'surulere');
select public.activate_price_table(tests.v('pt2'), 'Week 2 fare review');
select tests.eq((select version from public.price_tables where status = 'active'), 2, 'new version is live');
select tests.eq((select pt.version from public.jobs j join public.price_tables pt on pt.id = j.price_table_id where j.id = tests.v('job1')), 1,
                'old jobs keep the version they were priced with');
select tests.act('agent');
select tests.expect_error($q$select public.activate_price_table(tests.v('pt2'), 'x')$q$, 'FORBIDDEN');

-- ---------------------------------------------------------------- 8. runner vetting
select tests.act('lead');
select public.ops_set_runner_status(tests.u('runner_b'), 'suspended', 'Float not reconciled');
select tests.act('runner_b');
select tests.expect_error($q$select public.set_online(true)$q$, 'NOT_VERIFIED');
select tests.act('agent');
select tests.eq((select count(*) from public.suggest_runners(tests.v('job2')) where runner_id = tests.u('runner_b')), 0::bigint,
                'suspended runners are never suggested');

select tests.act('postgres');
\echo 'order engine: all scenarios passed'

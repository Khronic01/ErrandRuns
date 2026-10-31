-- Development seed. PLACEHOLDER DATA, NOT LAUNCH VALUES.
-- * Zone shapes are rough boxes so the app works locally; redraw real boundaries in the ops zone manager.
-- * Fares are illustrative. Only Yaba→Surulere ₦2,500, the ₦800 Buy & bring fee and the ₦700 stop fee
--   come from the PRD's worked example. "Final fare table for each zone pair" is an open decision.

insert into public.zones (slug, name, active, area) values
  ('yaba',        'Yaba',        true, extensions.st_geogfromtext('MULTIPOLYGON(((3.365 6.495, 3.395 6.495, 3.395 6.525, 3.365 6.525, 3.365 6.495)))')),
  ('surulere',    'Surulere',    true, extensions.st_geogfromtext('MULTIPOLYGON(((3.335 6.485, 3.364 6.485, 3.364 6.515, 3.335 6.515, 3.335 6.485)))')),
  ('ebute-metta', 'Ebute Metta', true, extensions.st_geogfromtext('MULTIPOLYGON(((3.370 6.470, 3.395 6.470, 3.395 6.494, 3.370 6.494, 3.370 6.470)))')),
  ('ikeja-gra',   'Ikeja GRA',   true, extensions.st_geogfromtext('MULTIPOLYGON(((3.335 6.570, 3.365 6.570, 3.365 6.600, 3.335 6.600, 3.335 6.570)))'));

-- Price table v1 is built as a draft, then published at the end of this file.
insert into public.price_tables (version, status, note, stop_fee_kobo, peak_surcharge_kobo, peak_windows)
values (1, 'draft', 'Pilot placeholder fares', 70000, 50000,
        '[{"dow":[1,2,3,4,5],"start":"07:00","end":"10:00"},{"dow":[1,2,3,4,5],"start":"16:00","end":"20:00"}]');

with t as (select id from public.price_tables where version = 1),
     z as (select slug, id from public.zones),
     f(a, b, naira) as (values
       ('yaba', 'yaba', 1500), ('surulere', 'surulere', 1500), ('ebute-metta', 'ebute-metta', 1500), ('ikeja-gra', 'ikeja-gra', 1500),
       ('yaba', 'surulere', 2500), ('yaba', 'ebute-metta', 2000), ('surulere', 'ebute-metta', 2500),
       ('ikeja-gra', 'yaba', 3500), ('ikeja-gra', 'surulere', 3500), ('ikeja-gra', 'ebute-metta', 4000))
insert into public.zone_fares (price_table_id, from_zone_id, to_zone_id, fare_kobo)
select t.id, za.id, zb.id, f.naira * 100
from f, t, z za, z zb where za.slug = f.a and zb.slug = f.b;

insert into public.task_fees (price_table_id, task_type, fee_kobo)
select t.id, v.task::public.task_type, v.naira * 100
from (select id from public.price_tables where version = 1) t,
     (values ('buy_and_bring', 800), ('collect', 500), ('drop_and_submit', 600),
             ('queue_and_wait', 1500), ('multi_stop', 800), ('send', 0)) v(task, naira);

insert into public.size_fees (price_table_id, size, fee_kobo)
select t.id, v.size::public.item_size, v.naira * 100
from (select id from public.price_tables where version = 1) t,
     (values ('envelope', 0), ('small_bag', 200), ('medium_box', 500)) v(size, naira);

-- PRD prohibited list (ops can edit).
insert into public.prohibited_items (term) values
  ('weapon'), ('gun'), ('knife'), ('ammunition'), ('drugs'), ('weed'), ('codeine'), ('tramadol'),
  ('cash delivery'), ('explosive'), ('gas cylinder'), ('live animal'), ('impersonate')
on conflict do nothing;

-- Publish v1 (in the app, ops does this with activate_price_table).
do $$ begin
  perform set_config('app.price_status_change', 'on', true);
  update public.price_tables set status = 'active', activated_at = now() where version = 1;
end $$;

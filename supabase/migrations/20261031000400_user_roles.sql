-- Account capabilities for customer, runner and business-owner experiences.
-- Runner verification and business approval remain authoritative in their own records.
-- This table must not be used by itself to authorize runner or business operations.
-- Requires public.profiles from the existing Errand Runs core schema.

begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception '20261031000400_user_roles requires public.profiles';
  end if;
end
$$;

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('customer', 'runner', 'business_owner')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table public.user_roles is
  'Account role selections only. Runner verification and business approval are enforced by their domain records; staff privileges remain in public.staff.';

insert into public.user_roles (user_id, role)
select id, 'customer'
from public.profiles
on conflict (user_id, role) do nothing;

alter table public.user_roles enable row level security;

revoke all on public.user_roles from public, anon, authenticated;
grant select, insert on public.user_roles to authenticated;

create policy user_roles_read_own
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy user_roles_insert_own
  on public.user_roles
  for insert
  to authenticated
  with check (user_id = auth.uid());

commit;

-- Rollback after removing dependent application code:
-- drop policy user_roles_insert_own on public.user_roles;
-- drop policy user_roles_read_own on public.user_roles;
-- drop table public.user_roles;

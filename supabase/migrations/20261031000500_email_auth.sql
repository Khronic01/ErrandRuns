-- Email-based authentication does not require a phone number on a profile.
-- Keep any existing phone values; they may still be useful as contact details.
-- Requires public.profiles from the existing Errand Runs core schema.

begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception '20261031000500_email_auth requires public.profiles';
  end if;
end
$$;

alter table public.profiles
  alter column phone drop not null;

commit;

-- Rollback after email-only accounts have supplied a phone number:
-- alter table public.profiles alter column phone set not null;

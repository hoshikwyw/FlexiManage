-- Local tool: dirty the local database the way a manual testing session does,
-- so `npm run test:db` can be checked against a used database (it must pass on
-- a fresh and on a used database; see docs/operations.md, "Database tests").
--
-- Run as postgres against the local stack only (never staging or production):
--   npm run db:dirty
-- which is
--   docker exec -i supabase_db_fleximanage psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /dev/stdin < scripts/db/dirty-state.sql
--
-- It lives under scripts/db, not supabase/tests, so pg_prove never collects it.
-- Re-runnable: fixed ids with `on conflict do nothing`; invitations and audit
-- rows accumulate on every run, which is the point. Nothing here violates the
-- seed invariants the tests rely on (A and B exist, alice owns A and is not in
-- B, bob owns B and is not in A).
--
-- What it does:
--   * three extra users (dirty-one/two/three@example.com, password123)
--   * two extra workspaces owned by dirty-one and dirty-two (triggers write the
--     owner memberships and audit rows)
--   * alice is admin of the first extra workspace
--   * alice (impersonated) creates four invitations in A; dirty-one accepts one
--     through accept_invitation(), alice revokes another; two stay pending
--   * workspace A is renamed and renamed back (updated_at moves)
--   * every profile is re-saved (updated_at moves)

begin;

-- ---------------------------------------------------------------------------
-- Users (same shape as supabase/seed.sql)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  false, false, now(), now(), now(), '', '', '', '', '', '', '', ''
from (values
  ('00000000-0000-0000-0000-0000000d0001'::uuid, 'dirty-one@example.com',   'Dirty One'),
  ('00000000-0000-0000-0000-0000000d0002'::uuid, 'dirty-two@example.com',   'Dirty Two'),
  ('00000000-0000-0000-0000-0000000d0003'::uuid, 'dirty-three@example.com', 'Dirty Three')
) as u(id, email, full_name)
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id, u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000d0003')
on conflict (provider_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Workspaces owned by the extra users; alice is admin of the first one
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name, slug, created_by) values
  ('00000000-0000-0000-0000-00000000d0aa', 'Dirty Workspace One', 'dirty-one', '00000000-0000-0000-0000-0000000d0001'),
  ('00000000-0000-0000-0000-00000000d0bb', 'Dirty Workspace Two', 'dirty-two', '00000000-0000-0000-0000-0000000d0002')
on conflict (id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
values ('00000000-0000-0000-0000-00000000d0aa', '00000000-0000-0000-0000-00000000000a', 'admin')
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Invitations in A, created by alice through RLS (actor_id = alice)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

insert into public.invitations (workspace_id, email, role, invited_by)
select '00000000-0000-0000-0000-0000000000aa', v.email, v.role::public.workspace_role, '00000000-0000-0000-0000-00000000000a'
from (values
  ('dirty-one@example.com',   'member'),
  ('dirty-two@example.com',   'admin'),
  ('dirty-three@example.com', 'member'),
  ('dirty-four@example.com',  'member')
) as v(email, role)
on conflict (workspace_id, lower(email)) where accepted_at is null do nothing;

-- alice revokes one (invitation.revoked with alice as actor)
delete from public.invitations
where workspace_id = '00000000-0000-0000-0000-0000000000aa'
  and email = 'dirty-four@example.com' and accepted_at is null;

reset role;
select set_config('request.jwt.claims', '', true);

-- dirty-one accepts theirs through the real function (member.added and
-- invitation.accepted with dirty-one as actor)
do $$
declare
  v_token text;
begin
  select i.token into v_token
  from public.invitations i
  where i.workspace_id = '00000000-0000-0000-0000-0000000000aa'
    and lower(i.email) = 'dirty-one@example.com' and i.accepted_at is null
  limit 1;
  if v_token is not null then
    perform set_config('request.jwt.claims',
      '{"sub": "00000000-0000-0000-0000-0000000d0001", "role": "authenticated"}', true);
    execute 'set local role authenticated';
    perform public.accept_invitation(v_token);
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Touch seed rows without changing their values
-- ---------------------------------------------------------------------------
update public.workspaces set name = 'Workspace A (dirty)' where id = '00000000-0000-0000-0000-0000000000aa';
update public.workspaces set name = 'Workspace A' where id = '00000000-0000-0000-0000-0000000000aa';
update public.profiles set full_name = full_name;

commit;

select 'dirty state applied' as status,
       (select count(*) from auth.users) as users,
       (select count(*) from public.workspaces) as workspaces,
       (select count(*) from public.workspace_members) as memberships,
       (select count(*) from public.invitations) as invitations,
       (select count(*) from public.audit_events) as audit_events;

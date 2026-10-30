-- Local development seed. Applied by `supabase db reset` after the migrations.
-- Idempotent: every insert is guarded with `on conflict do nothing`, so it can
-- be re-run with `psql ... -f supabase/seed.sql` against a running local stack.
--
-- Fixed identities (mirrored in tests/fixtures/ids.ts):
--
--   Users (password for both: password123)
--     alice@example.com  00000000-0000-0000-0000-00000000000a
--     bob@example.com    00000000-0000-0000-0000-00000000000b
--
--   Workspaces
--     Workspace A  slug workspace-a  00000000-0000-0000-0000-0000000000aa  owner: alice
--     Workspace B  slug workspace-b  00000000-0000-0000-0000-0000000000bb  owner: bob
--
-- Alice is NOT a member of B and Bob is NOT a member of A. The cross-workspace
-- denial tests (Part 3) rely on that.
--
-- Never run this against staging or production.

-- ---------------------------------------------------------------------------
-- auth.users
-- ---------------------------------------------------------------------------
-- The empty-string token columns avoid null-scan errors in GoTrue when it
-- reads these rows. raw_user_meta_data.full_name is picked up by the
-- handle_new_user trigger, which creates the public.profiles rows.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-00000000000a',
    'authenticated', 'authenticated',
    'alice@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Alice Example"}'::jsonb,
    false, false,
    now(), now(), now(),
    '', '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-00000000000b',
    'authenticated', 'authenticated',
    'bob@example.com',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Bob Example"}'::jsonb,
    false, false,
    now(), now(), now(),
    '', '', '', '', '', '', '', ''
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- auth.identities (one email identity per user; GoTrue expects these)
-- ---------------------------------------------------------------------------
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-00000000010a',
    '00000000-0000-0000-0000-00000000000a',
    '00000000-0000-0000-0000-00000000000a',
    jsonb_build_object(
      'sub', '00000000-0000-0000-0000-00000000000a',
      'email', 'alice@example.com',
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-00000000010b',
    '00000000-0000-0000-0000-00000000000b',
    '00000000-0000-0000-0000-00000000000b',
    jsonb_build_object(
      'sub', '00000000-0000-0000-0000-00000000000b',
      'email', 'bob@example.com',
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  )
on conflict (provider_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Workspaces. created_by drives the handle_new_workspace trigger, which adds
-- the owner membership and the workspace.created audit event (plus the
-- member.added event from the membership audit trigger). On conflict the
-- trigger does not fire, so re-running leaves memberships untouched.
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, name, slug, created_by)
values
  ('00000000-0000-0000-0000-0000000000aa', 'Workspace A', 'workspace-a',
   '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000bb', 'Workspace B', 'workspace-b',
   '00000000-0000-0000-0000-00000000000b')
on conflict (id) do nothing;

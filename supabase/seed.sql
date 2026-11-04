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
--     Workspace A  slug workspace-a  00000000-0000-0000-0000-0000000000aa  owner: alice  plan: Business
--     Workspace B  slug workspace-b  00000000-0000-0000-0000-0000000000bb  owner: bob    plan: Free
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

-- ---------------------------------------------------------------------------
-- Plans (migration 007). Every workspace starts on Free (the
-- workspaces_create_subscription trigger). Workspace A is moved to Business so
-- local development and the dirty-state script have room (20 members, 20
-- modules, 50,000 records, 10 GB); Workspace B stays on Free and is already at
-- its module limit (1 of 1: Projects), which shows the limit state in the app.
-- Seed writes run as postgres and are never limit-checked
-- (entitlement_check_bypassed). The update writes subscription.plan_changed
-- (actor null). Re-running leaves a plan alone once it was ever changed.
-- ---------------------------------------------------------------------------
update public.subscriptions s
   set plan_key = 'business'
 where s.workspace_id = '00000000-0000-0000-0000-0000000000aa'
   and s.plan_key = 'free'
   and not exists (
     select 1 from public.audit_events e
     where e.workspace_id = s.workspace_id
       and e.action = 'subscription.plan_changed'
   );

-- ---------------------------------------------------------------------------
-- Content (migration 004). Fixed ids mirrored in tests/fixtures/ids.ts.
--
--   Workspace A: module "Clients" (slug clients)   00000000-0000-0000-0000-0000000a0001
--     fields  company        text, required         00000000-0000-0000-0000-0000000f0001
--             contact_email  text                   00000000-0000-0000-0000-0000000f0002
--             status         select lead/active/churned  00000000-0000-0000-0000-0000000f0003
--             value          currency EUR, precision 2   00000000-0000-0000-0000-0000000f0004
--     records Acme Ltd / Globex / Initech           00000000-0000-0000-0000-0000000e0001..3
--   Workspace B: module "Projects" (slug projects), no fields, no records
--                                                   00000000-0000-0000-0000-0000000b0001
--
-- The module and field inserts fire the audit triggers (actor_id null, as for
-- every seed write). The record inserts run through
-- validate_record_custom_values(). Re-running leaves everything untouched.
-- ---------------------------------------------------------------------------
insert into public.modules (id, workspace_id, name, slug, description, icon, position, created_by)
values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000aa',
   'Clients', 'clients', 'Companies we work with.', 'building-2', 0,
   '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000000bb',
   'Projects', 'projects', null, null, 0,
   '00000000-0000-0000-0000-00000000000b')
on conflict (id) do nothing;

insert into public.field_definitions (id, workspace_id, module_id, key, label, type, required, position, options, settings)
values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'company', 'Company', 'text', true, 0,
   '[]'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'contact_email', 'Contact email', 'text', false, 1,
   '[]'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000f0003', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'status', 'Status', 'select', false, 2,
   '[{"value": "lead", "label": "Lead"},
     {"value": "active", "label": "Active"},
     {"value": "churned", "label": "Churned"}]'::jsonb,
   '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000f0004', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'value', 'Contract value', 'currency', false, 3,
   '[]'::jsonb, '{"currency": "EUR", "precision": 2}'::jsonb)
on conflict (id) do nothing;

insert into public.records (id, workspace_id, module_id, title, status, custom_values, created_by)
values
  ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'Acme Ltd', 'active',
   '{"company": "Acme Ltd", "contact_email": "jane@acme.example", "status": "active", "value": 12500.5}'::jsonb,
   '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'Globex Corporation', 'lead',
   '{"company": "Globex Corporation", "contact_email": "hank@globex.example", "status": "lead"}'::jsonb,
   '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000e0003', '00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-0000000a0001', 'Initech', 'churned',
   '{"company": "Initech", "status": "churned", "value": 0}'::jsonb,
   '00000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

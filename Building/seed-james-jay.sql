-- =============================================================================
-- Superhero CPR — One-off customer injection: James Jay
-- =============================================================================
-- Run against the target database (staging OR production) in the Supabase SQL
-- editor or via psql.
--
-- ⚠️  CHANGE THE PASSWORD before running if this is production.
--     Search for 'ChangeMe123!' below and replace it with a strong password.
--     The customer should reset their password on first login via:
--     /forgot-password
--
-- What this script does:
--   1. Creates an auth.users row (Supabase authentication)
--   2. Creates an auth.identities row (required for email/password sign-in)
--   3. Creates a profiles row with the customer's contact info
--
-- The script is idempotent if you use the same UUID — re-running it on a DB
-- that already has this user will raise a duplicate-key error and roll back
-- cleanly without partial writes.
-- =============================================================================

set search_path to public, extensions;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_email   text := 'nathanhedgeman@goldenagelearning.com';
  v_password text := 'ChangeMe123!'; -- ⚠️ Change before running in production
begin

  -- ── 1. Auth user ────────────────────────────────────────────────────────────
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '', '', '', ''
  );

  -- ── 2. Auth identity (required for email/password sign-in) ──────────────────
  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email',
    now(),
    now(),
    now()
  );

  -- ── 3. Customer profile ──────────────────────────────────────────────────────
  insert into profiles (
    id,
    first_name,
    last_name,
    email,
    phone,
    address,
    city,
    state,
    zip,
    role,
    archived,
    deactivated,
    created_at,
    updated_at
  ) values (
    v_user_id,
    'James',
    'Jay',
    v_email,
    '9418408422',
    '123 Faker Street',
    'Bradenton',
    'FL',
    '34222',
    'customer',
    false,
    false,
    now(),
    now()
  );

  raise notice 'Created customer James Jay (%) with email %', v_user_id, v_email;

end $$;

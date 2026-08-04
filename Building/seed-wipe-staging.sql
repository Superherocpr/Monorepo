-- =============================================================================
-- Superhero CPR — STAGING DATABASE WIPE
-- =============================================================================
-- ⚠️  STAGING ONLY. DO NOT RUN AGAINST PRODUCTION. ⚠️
--
-- This script wipes ALL public-schema data and ALL auth users
-- EXCEPT for accounts whose profile.role = 'super_admin'.
--
-- Super-admin auth.users rows are preserved (so they can still log in).
-- Their profile rows are preserved.
-- All other profiles, sessions, bookings, payments, invoices, certifications,
-- orders, contact, social, roster data, and instructor payment accounts are
-- destroyed.
--
-- Run BEFORE seed-staging.sql.
-- Safe to re-run.
-- =============================================================================

-- Hard refuse to run if there are zero super_admins — protects against
-- accidentally locking the database out.
do $$
declare
  super_admin_count int;
begin
  select count(*) into super_admin_count
  from profiles
  where role = 'super_admin' and (deactivated is null or deactivated = false);

  if super_admin_count = 0 then
    raise exception
      'Refusing to wipe: no active super_admin profiles found. '
      'Create one first or you will lose all admin access.';
  end if;

  raise notice 'Preserving % super_admin account(s).', super_admin_count;
end $$;

-- Capture the super-admin IDs we are preserving.
-- Stored in a TEMP TABLE so subsequent statements can reference them.
create temp table _preserved_admins on commit drop as
  select id from profiles where role = 'super_admin';

-- ── Delete app data in reverse dependency order ─────────────────────────────
-- Child tables first, then parents. Anything that FKs back to profiles is
-- deleted in full; profiles themselves are filtered to keep super_admins.

delete from stock_adjustments;
delete from order_items;
delete from orders;
delete from product_variants;
delete from products;

delete from roster_uploads;
delete from roster_records;

delete from invoice_activity_log;
delete from instructor_earnings;
delete from instructor_payout_items;
delete from instructor_payout_batches;
delete from payments;
delete from bookings;
delete from invoices;

delete from certifications;
delete from class_sessions;

delete from contact_replies;
delete from contact_submissions;
delete from social_feed_cache;

delete from api_keys;

delete from preset_grades;
delete from cert_types;
delete from class_types;
delete from locations;

delete from system_settings;

-- Profiles — keep only super_admins. Everything FK-referenced was already
-- deleted above, so this should succeed without violating constraints.
delete from profiles
where id not in (select id from _preserved_admins);

-- auth.users — same filter. profiles.id has ON DELETE CASCADE from auth.users,
-- but we already removed the dependent profile rows above, so this just removes
-- the auth identities for everyone except preserved super_admins.
delete from auth.identities
where user_id not in (select id from _preserved_admins);

delete from auth.users
where id not in (select id from _preserved_admins);

-- Reset the preserved super_admins so they look like fresh accounts
-- (no daily access code lingering, etc.) but keep their identity.
-- NOTE: archived_at / deactivated_at are in schema.sql but not yet in the live DB.
update profiles
set
  daily_access_code        = null,
  access_code_generated_at = null,
  archived                 = false,
  deactivated              = false,
  customer_notes           = null,
  paypal_payout_email      = null,
  updated_at               = now()
where id in (select id from _preserved_admins);

-- Final report.
do $$
declare
  remaining_profiles int;
  remaining_users int;
begin
  select count(*) into remaining_profiles from profiles;
  select count(*) into remaining_users from auth.users;
  raise notice
    'Wipe complete. % profile(s) and % auth user(s) preserved.',
    remaining_profiles, remaining_users;
end $$;

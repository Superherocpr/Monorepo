/**
 * TypeScript interfaces for user-related database tables.
 * Covers: profiles, instructor_payment_accounts, api_keys, system_settings.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/** Role values for the profiles.role enum. */
export type UserRole =
  | "customer"
  | "instructor"
  | "manager"
  | "super_admin"
  | "inspector";

/**
 * A user profile row from the `profiles` table.
 * Extends Supabase auth.users — id matches auth.users.id.
 */
export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  role: UserRole;
  is_lead_instructor: boolean;
  bio_slug: string | null;
  daily_access_code: string | null;
  access_code_generated_at: string | null;
  archived: boolean;
  archived_at: string | null;
  deactivated: boolean;
  deactivated_at: string | null;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Payment platform options for instructor_payment_accounts.platform enum. */
export type PaymentPlatform = "paypal" | "square" | "stripe" | "venmo_business";

/**
 * An OAuth-connected payment account for an instructor.
 * Only one record per instructor may have is_active = true at a time.
 */
export interface InstructorPaymentAccount {
  id: string;
  instructor_id: string;
  platform: PaymentPlatform;
  access_token: string | null;
  refresh_token: string | null;
  platform_account_id: string | null;
  is_active: boolean;
  connected_at: string;
}

/**
 * An API key record. Reserved for future external integrations.
 * key_hash stores a hashed value — the plain key is never stored.
 */
export interface ApiKey {
  id: string;
  profile_id: string;
  key_hash: string;
  label: string;
  last_used_at: string | null;
  created_at: string;
}

/**
 * A key-value system setting row.
 * Known keys: zoho_access_token, zoho_refresh_token, zoho_account_id,
 * zoho_token_expires_at, cert_reminders_paused.
 */
export interface SystemSetting {
  key: string;
  value: string;
  updated_at: string;
}

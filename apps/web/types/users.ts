/**
 * TypeScript interfaces for user-related database tables.
 * Covers: profiles, payment platform labels, api_keys, system_settings.
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
  /** Public S3 URL of the instructor's headshot. Null if no photo has been uploaded. */
  bio_photo: string | null;
  /** Plain-text bio paragraph shown on the /about page. Null if none has been written. */
  bio_description: string | null;
  /** Comma-separated credentials shown as checkmark items on the /about page (e.g. "AHA Instructor, BLS Provider"). Null if none entered. */
  bio_credentials: string | null;
  /** Whether this staff bio is published to the public /about page. */
  bio_published: boolean;
  /** Years of experience displayed on the lead instructor stat block (e.g. "20"). Null hides the stat. */
  bio_years_experience: string | null;
  /** Students trained figure displayed on the lead instructor stat block (e.g. "5,000+"). Null hides the stat. */
  bio_students_trained: string | null;
  daily_access_code: string | null;
  access_code_generated_at: string | null;
  archived: boolean;
  archived_at: string | null;
  deactivated: boolean;
  deactivated_at: string | null;
  customer_notes: string | null;
  /** PayPal email address where instructor payouts are sent. Null until configured. */
  paypal_payout_email: string | null;
  created_at: string;
  updated_at: string;
}

/** Payment platform values stored on invoices.payment_platform. */
export type PaymentPlatform = "paypal" | "square" | "stripe" | "venmo_business";

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

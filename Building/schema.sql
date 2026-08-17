-- =============================================================================
-- Superhero CPR — Full Database Schema (Idempotent DDL)
-- Run this BEFORE seed.sql.
-- Safe to re-run: all statements use IF NOT EXISTS or the DO/EXCEPTION pattern.
--
-- GENERATED — dumped directly from the production database (project
-- qgvlguifubbnclxfascz) on 2026-08-04. Do not hand-edit; regenerate from
-- the live schema instead, since migrations are the true source of truth
-- and this file exists only as a readable snapshot / DR reference.
-- =============================================================================

SET search_path TO public, extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- =============================================================================
-- ENUMS
-- PostgreSQL does not support CREATE TYPE IF NOT EXISTS, so we use the
-- DO/EXCEPTION pattern to make each enum creation idempotent.
-- =============================================================================

DO $$ BEGIN CREATE TYPE approval_status AS ENUM ('pending_approval','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE booking_source AS ENUM ('online','rollcall','invoice','manual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE invoice_status AS ENUM ('sent','paid','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE invoice_type AS ENUM ('individual','group'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_status AS ENUM ('pending','paid','shipped','delivered','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_platform_enum AS ENUM ('paypal','square','stripe','venmo_business'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending','completed','failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_type AS ENUM ('online','cash','check','deposit','invoice','promo'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE promo_discount_type AS ENUM ('fixed','percent','free'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE promo_scope AS ENUM ('all','session_type','session'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE session_status AS ENUM ('scheduled','in_progress','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('customer','instructor','manager','super_admin','inspector'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- USERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id                           uuid NOT NULL,
  first_name                   text NOT NULL,
  last_name                    text NOT NULL,
  email                        text NOT NULL,
  phone                        text,
  address                      text,
  city                         text,
  state                        text,
  zip                          text,
  role                         user_role NOT NULL DEFAULT 'customer'::user_role,
  is_lead_instructor           boolean NOT NULL DEFAULT false,
  bio_slug                     text,
  daily_access_code            text,
  access_code_generated_at     timestamptz,
  archived                     boolean NOT NULL DEFAULT false,
  archived_at                  timestamptz,
  deactivated                  boolean NOT NULL DEFAULT false,
  deactivated_at               timestamptz,
  customer_notes               text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  bio_published                boolean NOT NULL DEFAULT false,
  paypal_payout_email          text,
  bio_photo                    text,
  bio_description              text,
  bio_credentials              text,
  bio_years_experience         text,
  bio_students_trained         text,
  PRIMARY KEY (id),
  CONSTRAINT profiles_paypal_payout_email_check CHECK (((paypal_payout_email IS NULL) OR (paypal_payout_email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'::text))),
  CONSTRAINT profiles_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id                   uuid NOT NULL,
  key_hash                     text NOT NULL,
  label                        text NOT NULL,
  last_used_at                 timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key                          text NOT NULL,
  value                        text NOT NULL,
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key)
);

-- =============================================================================
-- SOCIAL
-- =============================================================================

CREATE TABLE IF NOT EXISTS social_feed_cache (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  facebook_post_id             text NOT NULL,
  photo_url                    text NOT NULL,
  post_url                     text NOT NULL,
  caption                      text,
  posted_at                    timestamptz NOT NULL,
  cached_at                    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT social_feed_cache_facebook_post_id_key UNIQUE (facebook_post_id)
);

-- =============================================================================
-- CONTACT
-- =============================================================================

CREATE TABLE IF NOT EXISTS contact_submissions (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  email                        text NOT NULL,
  phone                        text,
  inquiry_type                 text NOT NULL,
  message                      text NOT NULL,
  replied                      boolean NOT NULL DEFAULT false,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  called                       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS contact_replies (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  submission_id                uuid NOT NULL,
  sent_by                      uuid NOT NULL,
  subject                      text NOT NULL,
  body                         text NOT NULL,
  zoho_message_id              text,
  has_attachments              boolean NOT NULL DEFAULT false,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS contact_notes (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  submission_id                uuid NOT NULL,
  body                         text NOT NULL,
  created_by                   uuid NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT contact_notes_body_check CHECK ((char_length(TRIM(BOTH FROM body)) > 0))
);

-- =============================================================================
-- CERTIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS cert_types (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  description                  text,
  validity_months              int NOT NULL,
  issuing_body                 text,
  active                       boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  card_design                  text NOT NULL DEFAULT 'aha'::text,
  PRIMARY KEY (id),
  CONSTRAINT cert_types_card_design_check CHECK ((card_design = ANY (ARRAY['aha'::text, 'superherocpr'::text]))),
  CONSTRAINT cert_types_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS certifications (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id                  uuid NOT NULL,
  cert_type_id                 uuid NOT NULL,
  session_id                   uuid,
  issued_at                    date NOT NULL,
  expires_at                   date NOT NULL,
  cert_number                  text,
  reminder_sent                boolean NOT NULL DEFAULT false,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- =============================================================================
-- CLASSES
-- =============================================================================

CREATE TABLE IF NOT EXISTS class_types (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  description                  text,
  duration_minutes             int NOT NULL,
  max_capacity                 int NOT NULL,
  price                        numeric(10,2) NOT NULL,
  active                       boolean NOT NULL DEFAULT true,
  cert_type_id                 uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  requires_assistant_at_capacity boolean NOT NULL DEFAULT false,
  is_aha                         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT class_types_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS locations (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  address                      text NOT NULL,
  city                         text NOT NULL,
  state                        text NOT NULL,
  zip                          text NOT NULL,
  notes                        text,
  is_home_base                 boolean NOT NULL DEFAULT false,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS class_requests (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id                  uuid NOT NULL,
  class_type_id                uuid NOT NULL,
  preferred_date               date NOT NULL,
  preferred_time_of_day        text NOT NULL,
  group_size                   int NOT NULL,
  venue_name                   text NOT NULL,
  venue_address                text NOT NULL,
  venue_city                   text NOT NULL,
  venue_state                  text NOT NULL,
  venue_zip                    text NOT NULL,
  notes                        text,
  status                       text NOT NULL DEFAULT 'pending'::text,
  rejection_reason             text,
  travel_fee                   numeric NOT NULL DEFAULT 65,
  session_id                   uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT class_requests_group_size_check CHECK ((group_size >= 1)),
  CONSTRAINT class_requests_preferred_time_of_day_check CHECK ((preferred_time_of_day = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text, 'flexible'::text]))),
  CONSTRAINT class_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'instructor_assigned'::text])))
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  class_type_id                uuid NOT NULL,
  instructor_id                uuid,
  location_id                  uuid NOT NULL,
  starts_at                    timestamptz NOT NULL,
  ends_at                      timestamptz NOT NULL,
  max_capacity                 int NOT NULL,
  status                       session_status NOT NULL DEFAULT 'scheduled'::session_status,
  approval_status              approval_status NOT NULL DEFAULT 'pending_approval'::approval_status,
  rejection_reason             text,
  google_calendar_event_id     text,
  roster_imported              boolean NOT NULL DEFAULT false,
  session_token                text,
  correction_window_closes_at  timestamptz,
  enrollware_submitted         boolean NOT NULL DEFAULT false,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  discount_percent             numeric,
  travel_fee                   numeric,
  class_request_id             uuid,
  cancelled_at                 timestamptz,
  cancelled_by                 uuid,
  cancellation_reason          text,
  unclaimed_escalation_sent_at timestamptz,
  assistant_instructor_id      uuid,
  assistant_name               text,
  assistant_reminder_sent_at   timestamptz,
  additional_hours             int NOT NULL DEFAULT 0,
  is_private                   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  CONSTRAINT class_sessions_discount_percent_check CHECK (((discount_percent >= (0)::numeric) AND (discount_percent <= (50)::numeric))),
  CONSTRAINT class_sessions_session_token_key UNIQUE (session_token)
);

-- =============================================================================
-- INVOICES (must precede bookings — bookings.invoice_id references invoices)
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_number               text NOT NULL,
  class_session_id             uuid NOT NULL,
  instructor_id                uuid NOT NULL,
  invoice_type                 invoice_type NOT NULL,
  recipient_name               text NOT NULL,
  recipient_email              text NOT NULL,
  company_name                 text,
  student_count                int NOT NULL,
  amount_per_student           numeric(10,2) NOT NULL,
  custom_price                 boolean NOT NULL DEFAULT false,
  total_amount                 numeric(10,2) NOT NULL,
  payment_platform             payment_platform_enum NOT NULL,
  platform_invoice_id          text,
  status                       invoice_status NOT NULL DEFAULT 'sent'::invoice_status,
  notes                        text,
  paid_at                      timestamptz,
  cancelled_at                 timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number)
);

CREATE TABLE IF NOT EXISTS team_bookings (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                   uuid NOT NULL,
  company_name                 text NOT NULL,
  contact_name                 text NOT NULL,
  contact_email                text NOT NULL,
  contact_phone                text,
  payment_mode                 text NOT NULL,
  price_per_seat               numeric(10,2),
  total_price                  numeric(10,2),
  invoice_id                   uuid,
  share_token                  text NOT NULL,
  created_by                   uuid NOT NULL,
  class_request_id             uuid,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT team_bookings_share_token_key UNIQUE (share_token),
  CONSTRAINT team_bookings_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['company'::text, 'per_seat'::text]))),
  CONSTRAINT team_bookings_price_shape_check CHECK (
    ((payment_mode = 'per_seat'::text) AND (price_per_seat IS NOT NULL) AND (total_price IS NULL))
    OR
    ((payment_mode = 'company'::text) AND (total_price IS NOT NULL) AND (price_per_seat IS NULL))
  )
);

CREATE TABLE IF NOT EXISTS invoice_activity_log (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id                   uuid NOT NULL,
  actor_id                     uuid NOT NULL,
  action                       text NOT NULL,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- =============================================================================
-- BOOKINGS & PAYMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS bookings (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                   uuid NOT NULL,
  customer_id                  uuid NOT NULL,
  invoice_id                   uuid,
  booking_source               booking_source NOT NULL,
  team_booking_id              uuid,
  created_by                   uuid,
  manual_booking_reason        text,
  cancelled                    boolean NOT NULL DEFAULT false,
  cancellation_note            text,
  cancelled_by                 uuid,
  grade                        int,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS payments (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id                  uuid NOT NULL,
  booking_id                   uuid,
  logged_by                    uuid,
  amount                       numeric(10,2) NOT NULL,
  status                       payment_status NOT NULL,
  payment_type                 payment_type NOT NULL,
  paypal_transaction_id        text,
  routing_note                 text,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  paypal_fee_amount            numeric(10,2),
  net_amount                   numeric(10,2),
  PRIMARY KEY (id)
);

-- =============================================================================
-- INSTRUCTOR PAYOUTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS instructor_earnings (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  instructor_id                uuid NOT NULL,
  source_type                  text NOT NULL,
  booking_id                   uuid,
  invoice_id                   uuid,
  payment_id                   uuid,
  gross_amount                 numeric(10,2) NOT NULL,
  platform_fee_percent         numeric(5,2) NOT NULL,
  platform_fee_amount          numeric(10,2) NOT NULL,
  instructor_amount            numeric(10,2) NOT NULL,
  status                       text NOT NULL DEFAULT 'pending'::text,
  payout_batch_id              uuid,
  payout_item_id               uuid,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT instructor_earnings_gross_amount_check CHECK ((gross_amount >= (0)::numeric)),
  CONSTRAINT instructor_earnings_instructor_amount_check CHECK ((instructor_amount >= (0)::numeric)),
  CONSTRAINT instructor_earnings_platform_fee_amount_check CHECK ((platform_fee_amount >= (0)::numeric)),
  CONSTRAINT instructor_earnings_platform_fee_percent_check CHECK (((platform_fee_percent >= (0)::numeric) AND (platform_fee_percent <= (100)::numeric))),
  CONSTRAINT instructor_earnings_source_check CHECK ((((source_type = 'booking'::text) AND (booking_id IS NOT NULL) AND (invoice_id IS NULL)) OR ((source_type = 'invoice'::text) AND (invoice_id IS NOT NULL) AND (booking_id IS NULL)))),
  CONSTRAINT instructor_earnings_source_type_check CHECK ((source_type = ANY (ARRAY['booking'::text, 'invoice'::text]))),
  CONSTRAINT instructor_earnings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'payout_pending'::text, 'paid'::text, 'cancelled'::text, 'failed'::text])))
);

CREATE TABLE IF NOT EXISTS instructor_payout_batches (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by                   uuid,
  status                       text NOT NULL DEFAULT 'pending'::text,
  sender_batch_id              text NOT NULL,
  paypal_payout_batch_id       text,
  total_amount                 numeric(10,2) NOT NULL DEFAULT 0,
  item_count                   int NOT NULL DEFAULT 0,
  error_message                text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  submitted_at                 timestamptz,
  completed_at                 timestamptz,
  paypal_fee_total             numeric(10,2),
  denied_at                    timestamptz,
  denied_by                    uuid,
  denial_source                text,
  denial_reason                text,
  retry_of_batch_id            uuid,
  PRIMARY KEY (id),
  CONSTRAINT instructor_payout_batches_denial_source_check CHECK (((denial_source IS NULL) OR (denial_source = ANY (ARRAY['manual'::text, 'paypal_sync'::text, 'webhook'::text])))),
  CONSTRAINT instructor_payout_batches_item_count_check CHECK ((item_count >= 0)),
  CONSTRAINT instructor_payout_batches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assumed_complete'::text, 'completed'::text, 'denied'::text, 'failed'::text, 'needs_review'::text]))),
  CONSTRAINT instructor_payout_batches_total_amount_check CHECK ((total_amount >= (0)::numeric)),
  CONSTRAINT instructor_payout_batches_sender_batch_id_key UNIQUE (sender_batch_id)
);

CREATE TABLE IF NOT EXISTS instructor_payout_items (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  payout_batch_id              uuid NOT NULL,
  instructor_id                uuid NOT NULL,
  recipient_email              text NOT NULL,
  amount                       numeric(10,2) NOT NULL,
  status                       text NOT NULL DEFAULT 'pending'::text,
  paypal_payout_item_id        text,
  error_message                text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  paypal_fee_amount            numeric(10,2),
  unclaimed_expires_at         timestamptz,
  denied_at                    timestamptz,
  denied_by                    uuid,
  denial_source                text,
  denial_reason                text,
  PRIMARY KEY (id),
  CONSTRAINT instructor_payout_items_amount_check CHECK ((amount > (0)::numeric)),
  CONSTRAINT instructor_payout_items_denial_source_check CHECK (((denial_source IS NULL) OR (denial_source = ANY (ARRAY['manual'::text, 'paypal_sync'::text, 'webhook'::text])))),
  CONSTRAINT instructor_payout_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assumed_complete'::text, 'completed'::text, 'denied'::text, 'failed'::text, 'needs_review'::text, 'unclaimed'::text])))
);

CREATE TABLE IF NOT EXISTS instructor_payout_attempts (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  earning_id                   uuid NOT NULL,
  payout_batch_id              uuid NOT NULL,
  payout_item_id               uuid,
  instructor_id                uuid NOT NULL,
  amount                       numeric(10,2) NOT NULL,
  outcome                      text NOT NULL DEFAULT 'reserved'::text,
  note                         text,
  attempted_at                 timestamptz NOT NULL DEFAULT now(),
  resolved_at                  timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT instructor_payout_attempts_amount_check CHECK ((amount >= (0)::numeric)),
  CONSTRAINT instructor_payout_attempts_outcome_check CHECK ((outcome = ANY (ARRAY['reserved'::text, 'submitted'::text, 'completed'::text, 'denied'::text, 'failed'::text, 'needs_review'::text, 'unclaimed'::text]))),
  CONSTRAINT instructor_payout_attempts_unique UNIQUE (earning_id, payout_batch_id)
);

-- =============================================================================
-- ROSTERS & GRADING
-- =============================================================================

CREATE TABLE IF NOT EXISTS roster_records (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                   uuid NOT NULL,
  booking_id                   uuid,
  first_name                   text NOT NULL,
  last_name                    text NOT NULL,
  email                        text,
  phone                        text,
  employer                     text,
  grade                        int,
  confirmed                    boolean NOT NULL DEFAULT false,
  corrected                    boolean NOT NULL DEFAULT false,
  device_token                 text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  address_1                    text,
  address_2                    text,
  city                         text,
  state                        text,
  zip                          text,
  ccf_compression              int,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS roster_uploads (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id                   uuid NOT NULL,
  session_id                   uuid NOT NULL,
  file_url                     text NOT NULL,
  original_filename            text NOT NULL,
  submitted_by_name            text,
  submitted_by_email           text,
  imported                     boolean NOT NULL DEFAULT false,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS preset_grades (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  value                        int NOT NULL,
  label                        text NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT preset_grades_value_key UNIQUE (value)
);

-- =============================================================================
-- ADD-ONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS addons (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  description                  text,
  price                        numeric(10,2) NOT NULL DEFAULT 0,
  active                       boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT addons_price_check CHECK ((price >= (0)::numeric)),
  CONSTRAINT addons_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS addon_class_types (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  addon_id                     uuid NOT NULL,
  class_type_id                uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT addon_class_types_unique UNIQUE (addon_id, class_type_id)
);

CREATE TABLE IF NOT EXISTS session_addons (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                   uuid NOT NULL,
  addon_id                     uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT session_addons_unique UNIQUE (session_id, addon_id)
);

CREATE TABLE IF NOT EXISTS booking_addons (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_id                   uuid NOT NULL,
  addon_id                     uuid NOT NULL,
  price_at_booking             numeric(10,2) NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT booking_addons_price_at_booking_check CHECK ((price_at_booking >= (0)::numeric)),
  CONSTRAINT booking_addons_unique UNIQUE (booking_id, addon_id)
);

-- =============================================================================
-- PROMO CODES
-- =============================================================================

CREATE TABLE IF NOT EXISTS promo_codes (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  code                         text NOT NULL,
  discount_type                promo_discount_type NOT NULL,
  discount_value               numeric(10,2) NOT NULL DEFAULT 0,
  expires_at                   timestamptz,
  active                       boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid,
  scope                        promo_scope NOT NULL DEFAULT 'session'::promo_scope,
  PRIMARY KEY (id),
  CONSTRAINT promo_codes_discount_value_check CHECK ((discount_value >= (0)::numeric)),
  CONSTRAINT promo_codes_percent_range CHECK (((discount_type <> 'percent'::promo_discount_type) OR ((discount_value >= (0)::numeric) AND (discount_value <= (100)::numeric)))),
  CONSTRAINT promo_codes_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS promo_code_class_types (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  promo_code_id                uuid NOT NULL,
  class_type_id                uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT promo_code_class_types_unique UNIQUE (promo_code_id, class_type_id)
);

CREATE TABLE IF NOT EXISTS promo_code_sessions (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  promo_code_id                uuid NOT NULL,
  session_id                   uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT promo_code_sessions_unique UNIQUE (promo_code_id, session_id)
);

-- =============================================================================
-- BLOG
-- =============================================================================

CREATE TABLE IF NOT EXISTS blog_posts (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  title                        text NOT NULL,
  slug                         text NOT NULL,
  excerpt                      text,
  body                         text NOT NULL DEFAULT ''::text,
  cover_image_url              text,
  seo_title                    text,
  seo_description              text,
  target_keyword               text,
  status                       text NOT NULL DEFAULT 'draft'::text,
  published_at                 timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT blog_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text]))),
  CONSTRAINT blog_posts_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS blog_tags (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  slug                         text NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT blog_tags_name_key UNIQUE (name),
  CONSTRAINT blog_tags_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS blog_post_tags (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id                      uuid NOT NULL,
  tag_id                       uuid NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT blog_post_tags_post_id_tag_id_key UNIQUE (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS blog_slug_redirects (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  old_slug                     text NOT NULL,
  new_slug                     text NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT blog_slug_redirects_old_slug_key UNIQUE (old_slug)
);

-- =============================================================================
-- MERCH
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  name                         text NOT NULL,
  description                  text,
  price                        numeric(10,2) NOT NULL,
  image_url                    text,
  active                       boolean NOT NULL DEFAULT true,
  low_stock_threshold          int NOT NULL DEFAULT 5,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS product_variants (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id                   uuid NOT NULL,
  size                         text NOT NULL,
  stock_quantity               int NOT NULL DEFAULT 0,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS orders (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id                  uuid NOT NULL,
  status                       order_status NOT NULL DEFAULT 'pending'::order_status,
  total_amount                 numeric(10,2) NOT NULL,
  paypal_transaction_id        text,
  shipping_name                text NOT NULL,
  shipping_address             text NOT NULL,
  shipping_city                text NOT NULL,
  shipping_state               text NOT NULL,
  shipping_zip                 text NOT NULL,
  tracking_number              text,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id                     uuid NOT NULL,
  variant_id                   uuid NOT NULL,
  quantity                     int NOT NULL DEFAULT 1,
  price_at_purchase            numeric(10,2) NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  variant_id                   uuid NOT NULL,
  adjusted_by                  uuid NOT NULL,
  previous_quantity            int NOT NULL,
  new_quantity                 int NOT NULL,
  notes                        text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- =============================================================================
-- WEBHOOKS
-- =============================================================================

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id                     text NOT NULL,
  event_type                   text NOT NULL,
  resource_id                  text,
  received_at                  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id)
);

-- =============================================================================
-- FOREIGN KEYS (added after all tables exist to avoid ordering issues)
-- =============================================================================

DO $$ BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE api_keys ADD CONSTRAINT api_keys_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE contact_replies ADD CONSTRAINT contact_replies_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE contact_replies ADD CONSTRAINT contact_replies_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES contact_submissions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE contact_notes ADD CONSTRAINT contact_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE contact_notes ADD CONSTRAINT contact_notes_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES contact_submissions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE certifications ADD CONSTRAINT certifications_cert_type_id_fkey FOREIGN KEY (cert_type_id) REFERENCES cert_types(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE certifications ADD CONSTRAINT certifications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE certifications ADD CONSTRAINT certifications_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_types ADD CONSTRAINT class_types_cert_type_id_fkey FOREIGN KEY (cert_type_id) REFERENCES cert_types(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_requests ADD CONSTRAINT class_requests_class_type_id_fkey FOREIGN KEY (class_type_id) REFERENCES class_types(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_requests ADD CONSTRAINT class_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_requests ADD CONSTRAINT class_requests_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_assistant_instructor_id_fkey FOREIGN KEY (assistant_instructor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_class_request_id_fkey FOREIGN KEY (class_request_id) REFERENCES class_requests(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_class_type_id_fkey FOREIGN KEY (class_type_id) REFERENCES class_types(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_class_session_id_fkey FOREIGN KEY (class_session_id) REFERENCES class_sessions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE invoice_activity_log ADD CONSTRAINT invoice_activity_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE invoice_activity_log ADD CONSTRAINT invoice_activity_log_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_earnings ADD CONSTRAINT instructor_earnings_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_earnings ADD CONSTRAINT instructor_earnings_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_earnings ADD CONSTRAINT instructor_earnings_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_earnings ADD CONSTRAINT instructor_earnings_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_earnings ADD CONSTRAINT instructor_earnings_payout_batch_id_fkey FOREIGN KEY (payout_batch_id) REFERENCES instructor_payout_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_earnings ADD CONSTRAINT instructor_earnings_payout_item_id_fkey FOREIGN KEY (payout_item_id) REFERENCES instructor_payout_items(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_batches ADD CONSTRAINT instructor_payout_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_batches ADD CONSTRAINT instructor_payout_batches_denied_by_fkey FOREIGN KEY (denied_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_batches ADD CONSTRAINT instructor_payout_batches_retry_of_fkey FOREIGN KEY (retry_of_batch_id) REFERENCES instructor_payout_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_items ADD CONSTRAINT instructor_payout_items_denied_by_fkey FOREIGN KEY (denied_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_items ADD CONSTRAINT instructor_payout_items_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_items ADD CONSTRAINT instructor_payout_items_payout_batch_id_fkey FOREIGN KEY (payout_batch_id) REFERENCES instructor_payout_batches(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_attempts ADD CONSTRAINT instructor_payout_attempts_earning_id_fkey FOREIGN KEY (earning_id) REFERENCES instructor_earnings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_attempts ADD CONSTRAINT instructor_payout_attempts_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_attempts ADD CONSTRAINT instructor_payout_attempts_payout_batch_id_fkey FOREIGN KEY (payout_batch_id) REFERENCES instructor_payout_batches(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE instructor_payout_attempts ADD CONSTRAINT instructor_payout_attempts_payout_item_id_fkey FOREIGN KEY (payout_item_id) REFERENCES instructor_payout_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE roster_records ADD CONSTRAINT roster_records_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE roster_records ADD CONSTRAINT roster_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE roster_uploads ADD CONSTRAINT roster_uploads_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE roster_uploads ADD CONSTRAINT roster_uploads_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE addon_class_types ADD CONSTRAINT addon_class_types_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE addon_class_types ADD CONSTRAINT addon_class_types_class_type_id_fkey FOREIGN KEY (class_type_id) REFERENCES class_types(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE session_addons ADD CONSTRAINT session_addons_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE session_addons ADD CONSTRAINT session_addons_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE booking_addons ADD CONSTRAINT booking_addons_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES addons(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE booking_addons ADD CONSTRAINT booking_addons_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promo_code_class_types ADD CONSTRAINT promo_code_class_types_class_type_id_fkey FOREIGN KEY (class_type_id) REFERENCES class_types(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promo_code_class_types ADD CONSTRAINT promo_code_class_types_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promo_code_sessions ADD CONSTRAINT promo_code_sessions_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE promo_code_sessions ADD CONSTRAINT promo_code_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES class_sessions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE blog_post_tags ADD CONSTRAINT blog_post_tags_post_id_fkey FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE blog_post_tags ADD CONSTRAINT blog_post_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES blog_tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_adjusted_by_fkey FOREIGN KEY (adjusted_by) REFERENCES profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS profiles_daily_access_code_unique ON profiles USING btree (daily_access_code) WHERE (daily_access_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_api_keys_profile_id ON api_keys USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_contact_replies_sent_by ON contact_replies USING btree (sent_by);
CREATE INDEX IF NOT EXISTS idx_contact_replies_submission_id ON contact_replies USING btree (submission_id);
CREATE INDEX IF NOT EXISTS contact_notes_submission_idx ON contact_notes USING btree (submission_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certifications_cert_type_id ON certifications USING btree (cert_type_id);
CREATE INDEX IF NOT EXISTS idx_certifications_customer_id ON certifications USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_certifications_session_id ON certifications USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_class_types_cert_type_id ON class_types USING btree (cert_type_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_class_type_id ON class_sessions USING btree (class_type_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_instructor_id ON class_sessions USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_location_id ON class_sessions USING btree (location_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_open_opportunities ON class_sessions USING btree (starts_at) WHERE ((status = 'cancelled'::session_status) AND (instructor_id IS NULL));
CREATE INDEX IF NOT EXISTS idx_invoices_class_session_id ON invoices USING btree (class_session_id);
CREATE INDEX IF NOT EXISTS idx_invoices_instructor_id ON invoices USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_actor_id ON invoice_activity_log USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_invoice_activity_log_invoice_id ON invoice_activity_log USING btree (invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_online_session_customer_unique ON bookings USING btree (session_id, customer_id) WHERE ((booking_source = 'online'::booking_source) AND (cancelled = false));
CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_by ON bookings USING btree (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_bookings_created_by ON bookings USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_invoice_id ON bookings USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_bookings_session_id ON bookings USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_logged_by ON payments USING btree (logged_by);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_booking_id ON instructor_earnings USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_instructor_id ON instructor_earnings USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_invoice_id_e ON instructor_earnings USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_instructor_earnings_payment_id ON instructor_earnings USING btree (payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS instructor_earnings_booking_unique ON instructor_earnings USING btree (booking_id) WHERE (booking_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS instructor_earnings_invoice_unique ON instructor_earnings USING btree (invoice_id) WHERE (invoice_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS instructor_earnings_status_idx ON instructor_earnings USING btree (status, instructor_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_batches_created_by ON instructor_payout_batches USING btree (created_by);
CREATE INDEX IF NOT EXISTS instructor_payout_batches_retry_of_idx ON instructor_payout_batches USING btree (retry_of_batch_id) WHERE (retry_of_batch_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS instructor_payout_batches_status_idx ON instructor_payout_batches USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_items_batch_id ON instructor_payout_items USING btree (payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_instructor_payout_items_instructor_id ON instructor_payout_items USING btree (instructor_id);
CREATE INDEX IF NOT EXISTS instructor_payout_items_batch_idx ON instructor_payout_items USING btree (payout_batch_id);
CREATE INDEX IF NOT EXISTS instructor_payout_items_instructor_idx ON instructor_payout_items USING btree (instructor_id, status);
CREATE INDEX IF NOT EXISTS instructor_payout_attempts_batch_idx ON instructor_payout_attempts USING btree (payout_batch_id);
CREATE INDEX IF NOT EXISTS instructor_payout_attempts_earning_idx ON instructor_payout_attempts USING btree (earning_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_roster_records_booking_id ON roster_records USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_roster_records_session_id ON roster_records USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_roster_uploads_invoice_id ON roster_uploads USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_roster_uploads_session_id ON roster_uploads USING btree (session_id);
CREATE INDEX IF NOT EXISTS addon_class_types_addon_id_idx ON addon_class_types USING btree (addon_id);
CREATE INDEX IF NOT EXISTS addon_class_types_class_type_id_idx ON addon_class_types USING btree (class_type_id);
CREATE INDEX IF NOT EXISTS session_addons_addon_id_idx ON session_addons USING btree (addon_id);
CREATE INDEX IF NOT EXISTS session_addons_session_id_idx ON session_addons USING btree (session_id);
CREATE INDEX IF NOT EXISTS booking_addons_addon_id_idx ON booking_addons USING btree (addon_id);
CREATE INDEX IF NOT EXISTS booking_addons_booking_id_idx ON booking_addons USING btree (booking_id);
CREATE INDEX IF NOT EXISTS promo_code_class_types_class_type_id_idx ON promo_code_class_types USING btree (class_type_id);
CREATE INDEX IF NOT EXISTS promo_code_class_types_promo_code_id_idx ON promo_code_class_types USING btree (promo_code_id);
CREATE INDEX IF NOT EXISTS promo_code_sessions_promo_code_id_idx ON promo_code_sessions USING btree (promo_code_id);
CREATE INDEX IF NOT EXISTS promo_code_sessions_session_id_idx ON promo_code_sessions USING btree (session_id);
CREATE INDEX IF NOT EXISTS blog_posts_slug ON blog_posts USING btree (slug);
CREATE INDEX IF NOT EXISTS blog_posts_status_published_at ON blog_posts USING btree (status, published_at DESC);
CREATE INDEX IF NOT EXISTS blog_post_tags_post_id ON blog_post_tags USING btree (post_id);
CREATE INDEX IF NOT EXISTS blog_post_tags_tag_id ON blog_post_tags USING btree (tag_id);
CREATE INDEX IF NOT EXISTS blog_slug_redirects_old_slug ON blog_slug_redirects USING btree (old_slug);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items USING btree (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_adjusted_by ON stock_adjustments USING btree (adjusted_by);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant_id ON stock_adjustments USING btree (variant_id);
CREATE INDEX IF NOT EXISTS processed_webhook_events_received_idx ON processed_webhook_events USING btree (received_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_feed_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cert_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_payout_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE addon_class_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_class_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_post_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_slug_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_anon_email_exists_check" ON profiles;
CREATE POLICY "profiles_anon_email_exists_check" ON profiles
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "profiles_anon_insert_own" ON profiles;
CREATE POLICY "profiles_anon_insert_own" ON profiles
  FOR INSERT TO anon,authenticated
  WITH CHECK ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_anon_read_lead_instructor" ON profiles;
CREATE POLICY "profiles_anon_read_lead_instructor" ON profiles
  FOR SELECT TO anon
  USING (((is_lead_instructor = true) AND (deactivated = false)));

DROP POLICY IF EXISTS "profiles_auth_read_own" ON profiles;
CREATE POLICY "profiles_auth_read_own" ON profiles
  FOR SELECT TO authenticated
  USING ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_auth_update_own" ON profiles;
CREATE POLICY "profiles_auth_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

DROP POLICY IF EXISTS "social_feed_cache_anon_read" ON social_feed_cache;
CREATE POLICY "social_feed_cache_anon_read" ON social_feed_cache
  FOR SELECT TO anon,authenticated
  USING (true);

DROP POLICY IF EXISTS "contact_submissions_anon_insert" ON contact_submissions;
CREATE POLICY "contact_submissions_anon_insert" ON contact_submissions
  FOR INSERT TO anon,authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "cert_types_anon_read_active" ON cert_types;
CREATE POLICY "cert_types_anon_read_active" ON cert_types
  FOR SELECT TO anon,authenticated
  USING ((active = true));

DROP POLICY IF EXISTS "class_types_anon_read_active" ON class_types;
CREATE POLICY "class_types_anon_read_active" ON class_types
  FOR SELECT TO anon,authenticated
  USING ((active = true));

DROP POLICY IF EXISTS "locations_anon_read" ON locations;
CREATE POLICY "locations_anon_read" ON locations
  FOR SELECT TO anon,authenticated
  USING (true);

DROP POLICY IF EXISTS "class_sessions_anon_read_public" ON class_sessions;
CREATE POLICY "class_sessions_anon_read_public" ON class_sessions
  FOR SELECT TO anon,authenticated
  USING (((status = 'scheduled'::session_status) AND (approval_status = 'approved'::approval_status) AND (starts_at > now())));

DROP POLICY IF EXISTS "bookings_auth_read_own" ON bookings;
CREATE POLICY "bookings_auth_read_own" ON bookings
  FOR SELECT TO authenticated
  USING ((customer_id = auth.uid()));

DROP POLICY IF EXISTS "roster_records_anon_read_by_session" ON roster_records;
CREATE POLICY "roster_records_anon_read_by_session" ON roster_records
  FOR SELECT TO anon,authenticated
  USING (true);

DROP POLICY IF EXISTS "public_read_published_posts" ON blog_posts;
CREATE POLICY "public_read_published_posts" ON blog_posts
  FOR SELECT TO public
  USING ((status = 'published'::text));

DROP POLICY IF EXISTS "public_read_tags" ON blog_tags;
CREATE POLICY "public_read_tags" ON blog_tags
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "public_read_post_tags" ON blog_post_tags;
CREATE POLICY "public_read_post_tags" ON blog_post_tags
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM blog_posts p
  WHERE ((p.id = blog_post_tags.post_id) AND (p.status = 'published'::text)))));

DROP POLICY IF EXISTS "public_read_slug_redirects" ON blog_slug_redirects;
CREATE POLICY "public_read_slug_redirects" ON blog_slug_redirects
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "products_anon_read_active" ON products;
CREATE POLICY "products_anon_read_active" ON products
  FOR SELECT TO anon,authenticated
  USING ((active = true));

DROP POLICY IF EXISTS "product_variants_anon_read" ON product_variants;
CREATE POLICY "product_variants_anon_read" ON product_variants
  FOR SELECT TO anon,authenticated
  USING (true);

DROP POLICY IF EXISTS "orders_auth_read_own" ON orders;
CREATE POLICY "orders_auth_read_own" ON orders
  FOR SELECT TO authenticated
  USING ((customer_id = auth.uid()));

-- =============================================================================
-- GRANTS
-- All other tables keep Supabase's default anon/authenticated/service_role
-- grants; RLS policies above gate actual row access. These payout-accounting
-- and webhook-idempotency tables are service_role-only end to end.
-- =============================================================================

REVOKE ALL ON TABLE instructor_earnings FROM anon, authenticated;
REVOKE ALL ON TABLE instructor_payout_batches FROM anon, authenticated;
REVOKE ALL ON TABLE instructor_payout_items FROM anon, authenticated;
REVOKE ALL ON TABLE instructor_payout_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE processed_webhook_events FROM anon, authenticated;

GRANT ALL ON TABLE instructor_earnings TO service_role;
GRANT ALL ON TABLE instructor_payout_batches TO service_role;
GRANT ALL ON TABLE instructor_payout_items TO service_role;
GRANT ALL ON TABLE instructor_payout_attempts TO service_role;
GRANT ALL ON TABLE processed_webhook_events TO service_role;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.blog_posts_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.book_spot(p_session_id uuid, p_customer_id uuid, p_booking_source text DEFAULT 'online'::text, p_invoice_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_capacity int;
  v_status text;
  v_approval text;
  v_taken int;
  v_booking_id uuid;
  v_existing_id uuid;
begin
  select max_capacity, status, approval_status
    into v_capacity, v_status, v_approval
  from class_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'cancelled' or v_approval <> 'approved' then
    raise exception 'session_unavailable' using errcode = 'P0001';
  end if;

  if p_booking_source = 'online' then
    select id into v_existing_id
    from bookings
    where session_id = p_session_id
      and customer_id = p_customer_id
      and booking_source = 'online'
      and cancelled = false
    limit 1;

    if found then
      raise exception 'already_booked' using errcode = 'P0001';
    end if;
  end if;

  select
    coalesce((select count(*) from bookings
              where session_id = p_session_id and cancelled = false), 0) +
    coalesce((select sum(student_count) from invoices
              where class_session_id = p_session_id
                and status not in ('cancelled', 'paid')), 0)
    into v_taken;

  if v_taken >= v_capacity then
    raise exception 'session_full' using errcode = 'P0001';
  end if;

  insert into bookings (session_id, customer_id, booking_source, invoice_id, cancelled)
  values (p_session_id, p_customer_id, p_booking_source::booking_source, p_invoice_id, false)
  returning id into v_booking_id;

  return v_booking_id;
end;
$function$

REVOKE ALL ON FUNCTION public.book_spot FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_spot TO service_role;

CREATE OR REPLACE FUNCTION public.decrement_stock_if_available(p_variant_id uuid, p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock int;
BEGIN
  SELECT stock_quantity INTO v_stock
  FROM product_variants
  WHERE id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_stock < p_amount THEN
    RETURN false;
  END IF;

  UPDATE product_variants
     SET stock_quantity = stock_quantity - p_amount
   WHERE id = p_variant_id;

  RETURN true;
END;
$function$

REVOKE ALL ON FUNCTION public.decrement_stock_if_available FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_stock_if_available TO service_role;

CREATE OR REPLACE FUNCTION public.mark_invoice_paid(p_invoice_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice  invoices%ROWTYPE;
  v_paid_at  timestamptz := now();
BEGIN
  -- Lock the invoice row to prevent concurrent calls from double-inserting
  -- bookings and double-marking the invoice paid.
  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status <> 'sent' THEN
    -- Invoice is already paid, cancelled, or in an unexpected state.
    RAISE EXCEPTION 'invoice_not_sent' USING ERRCODE = 'P0001';
  END IF;

  -- Mark the invoice as paid.
  UPDATE invoices
  SET status  = 'paid',
      paid_at = v_paid_at
  WHERE id = p_invoice_id;

  -- Insert one booking row per student slot.
  -- customer_id = instructor_id: the instructor acts as the booking agent.
  INSERT INTO bookings (session_id, customer_id, invoice_id, booking_source, created_by)
  SELECT
    v_invoice.class_session_id,
    v_invoice.instructor_id,
    p_invoice_id,
    'invoice',
    p_actor_id
  FROM generate_series(1, v_invoice.student_count);

  -- Audit log.
  INSERT INTO invoice_activity_log (invoice_id, actor_id, action)
  VALUES (p_invoice_id, p_actor_id, 'marked_paid');

  RETURN jsonb_build_object('success', true, 'paid_at', v_paid_at);
END;
$function$

REVOKE ALL ON FUNCTION public.mark_invoice_paid FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_invoice_paid TO service_role;

CREATE OR REPLACE FUNCTION public.regenerate_instructor_access_codes()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update profiles
  set
    daily_access_code       = lpad((floor(random() * 1000000))::int::text, 6, '0'),
    access_code_generated_at = now(),
    updated_at               = now()
  where
    role in ('instructor', 'super_admin')
    and (deactivated is null or deactivated = false);
$function$

REVOKE ALL ON FUNCTION public.regenerate_instructor_access_codes FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_instructor_access_codes TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_instructor_payout_batch(p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id uuid;
  v_sender_batch_id text;
  v_total numeric(10,2);
  v_item_count int;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_actor_id
      AND role = 'super_admin'
      AND archived = false
      AND deactivated = false
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = 'P0001';
  END IF;

  DROP TABLE IF EXISTS pg_temp.reserve_payout_eligible;

  CREATE TEMP TABLE reserve_payout_eligible ON COMMIT DROP AS
  SELECT
    e.id AS earning_id,
    e.instructor_id,
    e.instructor_amount,
    lower(trim(p.paypal_payout_email)) AS recipient_email
  FROM instructor_earnings e
  JOIN profiles p ON p.id = e.instructor_id
  WHERE e.status = 'pending'
    AND e.instructor_amount > 0
    AND p.paypal_payout_email IS NOT NULL
    AND trim(p.paypal_payout_email) <> ''
    AND p.deactivated = false
    AND p.archived = false
  FOR UPDATE OF e SKIP LOCKED;

  SELECT
    coalesce(round(sum(instructor_amount)::numeric, 2), 0),
    count(DISTINCT instructor_id)
  INTO v_total, v_item_count
  FROM reserve_payout_eligible;

  IF v_item_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_eligible_earnings'
    );
  END IF;

  v_sender_batch_id := 'shcpr-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO instructor_payout_batches (
    created_by,
    status,
    sender_batch_id,
    total_amount,
    item_count
  )
  VALUES (
    p_actor_id,
    'pending',
    v_sender_batch_id,
    v_total,
    v_item_count
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO instructor_payout_items (
    payout_batch_id,
    instructor_id,
    recipient_email,
    amount,
    status
  )
  SELECT
    v_batch_id,
    instructor_id,
    recipient_email,
    round(sum(instructor_amount)::numeric, 2),
    'pending'
  FROM reserve_payout_eligible
  GROUP BY instructor_id, recipient_email;

  UPDATE instructor_earnings e
  SET
    status = 'payout_pending',
    payout_batch_id = v_batch_id,
    payout_item_id = i.id,
    updated_at = now()
  FROM reserve_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  WHERE e.id = eligible.earning_id;

  -- Permanent record of which earnings went into this batch, so the link
  -- survives reconciliation clearing payout_batch_id on failure.
  INSERT INTO instructor_payout_attempts (
    earning_id,
    payout_batch_id,
    payout_item_id,
    instructor_id,
    amount,
    outcome
  )
  SELECT
    eligible.earning_id,
    v_batch_id,
    i.id,
    eligible.instructor_id,
    eligible.instructor_amount,
    'reserved'
  FROM reserve_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  ON CONFLICT (earning_id, payout_batch_id) DO NOTHING;

  SELECT jsonb_build_object(
    'success', true,
    'batch', jsonb_build_object(
      'id', b.id,
      'sender_batch_id', b.sender_batch_id,
      'total_amount', b.total_amount,
      'item_count', b.item_count
    ),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'instructor_id', i.instructor_id,
      'recipient_email', i.recipient_email,
      'amount', i.amount
    ) ORDER BY i.created_at), '[]'::jsonb)
  )
  INTO v_result
  FROM instructor_payout_batches b
  JOIN instructor_payout_items i ON i.payout_batch_id = b.id
  WHERE b.id = v_batch_id
  GROUP BY b.id, b.sender_batch_id, b.total_amount, b.item_count;

  RETURN v_result;
END;
$function$

REVOKE ALL ON FUNCTION public.reserve_instructor_payout_batch FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_instructor_payout_batch TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_payout_retry_batch(p_actor_id uuid, p_source_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_status text;
  v_attempted_count int;
  v_moved_count int;
  v_blocked_count int;
  v_available_count int;
  v_batch_id uuid;
  v_sender_batch_id text;
  v_total numeric(10,2);
  v_item_count int;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_actor_id
      AND role = 'super_admin'
      AND archived = false
      AND deactivated = false
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = 'P0001';
  END IF;

  SELECT status INTO v_source_status
  FROM instructor_payout_batches
  WHERE id = p_source_batch_id;

  IF v_source_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'source_batch_not_found');
  END IF;

  -- Only a batch we are certain did not deliver money may be retried.
  -- needs_review is excluded on purpose: its outcome is unknown.
  IF v_source_status NOT IN ('denied', 'failed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'source_batch_not_retryable',
      'status', v_source_status
    );
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE e.status <> 'pending'),
    count(*) FILTER (
      WHERE e.status = 'pending'
        AND (
          p.paypal_payout_email IS NULL
          OR trim(p.paypal_payout_email) = ''
          OR p.archived = true
          OR p.deactivated = true
          OR e.instructor_amount <= 0
        )
    )
  INTO v_attempted_count, v_moved_count, v_blocked_count
  FROM instructor_payout_attempts a
  JOIN instructor_earnings e ON e.id = a.earning_id
  JOIN profiles p ON p.id = e.instructor_id
  WHERE a.payout_batch_id = p_source_batch_id;

  IF v_attempted_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_attempt_history');
  END IF;

  IF v_moved_count > 0 OR v_blocked_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'earnings_changed',
      'attempted', v_attempted_count,
      'moved', v_moved_count,
      'blocked', v_blocked_count
    );
  END IF;

  DROP TABLE IF EXISTS pg_temp.retry_payout_eligible;

  CREATE TEMP TABLE retry_payout_eligible ON COMMIT DROP AS
  SELECT
    e.id AS earning_id,
    e.instructor_id,
    e.instructor_amount,
    lower(trim(p.paypal_payout_email)) AS recipient_email
  FROM instructor_payout_attempts a
  JOIN instructor_earnings e ON e.id = a.earning_id
  JOIN profiles p ON p.id = e.instructor_id
  WHERE a.payout_batch_id = p_source_batch_id
    AND e.status = 'pending'
    AND e.instructor_amount > 0
    AND p.paypal_payout_email IS NOT NULL
    AND trim(p.paypal_payout_email) <> ''
    AND p.deactivated = false
    AND p.archived = false
  FOR UPDATE OF e SKIP LOCKED;

  SELECT count(*) INTO v_available_count FROM retry_payout_eligible;

  -- A row lost to SKIP LOCKED means a concurrent payout is touching it.
  IF v_available_count <> v_attempted_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'earnings_locked',
      'attempted', v_attempted_count,
      'available', v_available_count
    );
  END IF;

  SELECT
    coalesce(round(sum(instructor_amount)::numeric, 2), 0),
    count(DISTINCT instructor_id)
  INTO v_total, v_item_count
  FROM retry_payout_eligible;

  v_sender_batch_id := 'shcpr-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO instructor_payout_batches (
    created_by,
    status,
    sender_batch_id,
    total_amount,
    item_count,
    retry_of_batch_id
  )
  VALUES (
    p_actor_id,
    'pending',
    v_sender_batch_id,
    v_total,
    v_item_count,
    p_source_batch_id
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO instructor_payout_items (
    payout_batch_id,
    instructor_id,
    recipient_email,
    amount,
    status
  )
  SELECT
    v_batch_id,
    instructor_id,
    recipient_email,
    round(sum(instructor_amount)::numeric, 2),
    'pending'
  FROM retry_payout_eligible
  GROUP BY instructor_id, recipient_email;

  UPDATE instructor_earnings e
  SET
    status = 'payout_pending',
    payout_batch_id = v_batch_id,
    payout_item_id = i.id,
    updated_at = now()
  FROM retry_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  WHERE e.id = eligible.earning_id;

  INSERT INTO instructor_payout_attempts (
    earning_id,
    payout_batch_id,
    payout_item_id,
    instructor_id,
    amount,
    outcome,
    note
  )
  SELECT
    eligible.earning_id,
    v_batch_id,
    i.id,
    eligible.instructor_id,
    eligible.instructor_amount,
    'reserved',
    'Retry of batch ' || p_source_batch_id::text
  FROM retry_payout_eligible eligible
  JOIN instructor_payout_items i
    ON i.payout_batch_id = v_batch_id
   AND i.instructor_id = eligible.instructor_id
  ON CONFLICT (earning_id, payout_batch_id) DO NOTHING;

  SELECT jsonb_build_object(
    'success', true,
    'batch', jsonb_build_object(
      'id', b.id,
      'sender_batch_id', b.sender_batch_id,
      'total_amount', b.total_amount,
      'item_count', b.item_count,
      'retry_of_batch_id', b.retry_of_batch_id
    ),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'instructor_id', i.instructor_id,
      'recipient_email', i.recipient_email,
      'amount', i.amount
    ) ORDER BY i.created_at), '[]'::jsonb)
  )
  INTO v_result
  FROM instructor_payout_batches b
  JOIN instructor_payout_items i ON i.payout_batch_id = b.id
  WHERE b.id = v_batch_id
  GROUP BY b.id, b.sender_batch_id, b.total_amount, b.item_count, b.retry_of_batch_id;

  RETURN v_result;
END;
$function$

REVOKE ALL ON FUNCTION public.reserve_payout_retry_batch FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_payout_retry_batch TO service_role;

CREATE OR REPLACE FUNCTION public.restore_stock(p_variant_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE product_variants
     SET stock_quantity = stock_quantity + p_amount
   WHERE id = p_variant_id;
END;
$function$

REVOKE ALL ON FUNCTION public.restore_stock FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_stock TO service_role;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

DROP TRIGGER IF EXISTS blog_posts_updated_at ON blog_posts;
CREATE TRIGGER blog_posts_updated_at BEFORE UPDATE ON blog_posts FOR EACH ROW EXECUTE FUNCTION blog_posts_set_updated_at();

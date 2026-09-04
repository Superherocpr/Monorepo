# ==============================================================================
# Superhero CPR — Environment Variables Master List
# ==============================================================================
# This file documents every environment variable required across the stack.
# Copy this to .env.local for development.
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. General / App Metadata
# ------------------------------------------------------------------------------
# The base URL of the application (no trailing slash)
# Used for: Roster correction links, OAuth callbacks, and email templates.
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# The business owner's email address.
# This account is hardcoded for protection: its role cannot be changed
# and it cannot be deactivated via the UI/API.
OWNER_EMAIL=info@superherocpr.com


# ------------------------------------------------------------------------------
# 2. Supabase (Database & Auth)
# ------------------------------------------------------------------------------
# Get these from: Supabase Project Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Service role key (SERVER-SIDE ONLY). NEVER expose this in the client.
# Used for: Bypassing RLS in admin API routes and background jobs.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key


# ------------------------------------------------------------------------------
# 3. Resend (Transactional Email)
# ------------------------------------------------------------------------------
# Get from: resend.com dashboard
RESEND_API_KEY=re_123456789

# The "From" address for all system emails.
# Must be a domain verified in your Resend account.
RESEND_FROM_EMAIL=Superhero CPR <noreply@superherocpr.com>

# The business inbox that customer-originated notifications are delivered to:
# contact form submissions, merch orders, and roster uploads.
# Optional — defaults to contact@superherocpr.com when unset.
CONTACT_EMAIL=contact@superherocpr.com


# ------------------------------------------------------------------------------
# 4. PayPal (Bookings, Invoices & Instructor Payouts)
# ------------------------------------------------------------------------------
# Get from: developer.paypal.com > Apps & Credentials.
# These are the main SuperHeroCPR business REST app credentials. Used for
# public bookings, invoices, and instructor payouts.
NEXT_PUBLIC_PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_SECRET=your-paypal-secret

# PayPal REST API environment. Production must use live PayPal; local/staging
# can use the sandbox URL below instead. Shared by both PayPal accounts.
PAYPAL_API_BASE=https://api-m.paypal.com
# PAYPAL_API_BASE=https://api-m.sandbox.paypal.com

# Webhook ID for the business PayPal account's INVOICING.INVOICE.PAID
# webhook subscription (PayPal business dashboard > Apps & Credentials >
# Webhooks). Must be subscribed to at least INVOICING.INVOICE.PAID, pointed
# at {NEXT_PUBLIC_BASE_URL}/api/webhooks/paypal-invoice. Authenticates
# inbound webhook requests — see lib/paypal.ts verifyPayPalWebhookSignature().
# Distinct from PAYPAL_WEBHOOK_ID, which is a different, pre-existing webhook
# subscription on this account — each subscription is scoped to its own
# target URL and PayPal assigns each a separate ID.
PAYPAL_INVOICE_WEBHOOK_ID=your-paypal-invoice-webhook-id

# ------------------------------------------------------------------------------
# 4b. PayPal — Merch Store (separate merchant account)
# ------------------------------------------------------------------------------
# A separate PayPal business account receives all merch store payments.
# Get the client ID and secret from developer.paypal.com > Apps & Credentials
# for the merch PayPal account.
NEXT_PUBLIC_PAYPAL_MERCH_CLIENT_ID=your-merch-paypal-client-id
PAYPAL_MERCH_SECRET=your-merch-paypal-secret

# Optional fallback if system_settings.platform_fee_percent is missing.
# The migration seeds platform_fee_percent = 20, meaning SuperHeroCPR keeps 20%
# and pays instructors the remaining 80%.
PLATFORM_FEE_PERCENT=20


# ------------------------------------------------------------------------------
# 5. Zoho Mail (Contact Form Replies)
# ------------------------------------------------------------------------------
# Get from: api-console.zoho.com (Server-based Application)
# Note: Tokens themselves are stored in the `system_settings` table.
ZOHO_CLIENT_ID=your-zoho-client-id
ZOHO_CLIENT_SECRET=your-zoho-client-secret
ZOHO_REDIRECT_URI=https://superherocpr.com/api/contact/zoho-callback


# ------------------------------------------------------------------------------
# 6. AWS S3 (File Storage)
# ------------------------------------------------------------------------------
# Used for: Roster file uploads, product images, and staff photos.
# Credentials: NOT set in Amplify env vars — AWS_* names are reserved by AWS.
# On Amplify: credentials + region come from the Lambda execution role automatically.
# Locally: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION in .env.local
#           are picked up by the SDK credential chain (do not rename these locally).
# Only S3_BUCKET_NAME needs to be set in Amplify env vars.
S3_BUCKET_NAME=superherocpr-assets


# ------------------------------------------------------------------------------
# 6b. Merchandise Shipping
# ------------------------------------------------------------------------------
# Flat shipping fee in USD for merch checkout. Used by the browser checkout and
# re-validated server-side when the order is confirmed. Set to 0 for free shipping.
NEXT_PUBLIC_SHIPPING_RATE=0


# ------------------------------------------------------------------------------
# 7. Twilio (SMS Notifications)
# ------------------------------------------------------------------------------
# Get from: twilio.com/console
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+15550000000


# ------------------------------------------------------------------------------
# 8. Enrollware (Internal References Only)
# ------------------------------------------------------------------------------
# No API keys required. The browser extension uses existing Supabase session.
# These variables are placeholders if future server-to-server calls are needed.
# ENROLLWARE_API_KEY=optional-if-needed


# ------------------------------------------------------------------------------
# 9. Facebook Graph API (Social Feed Cache)
# ------------------------------------------------------------------------------
# Used to fetch the latest photo posts from the business Facebook page and
# populate the social_feed_cache table.
#
# How to get these:
#   1. Create a Facebook App at developers.facebook.com
#   2. Add the "Pages API" product and request pages_read_engagement +
#      pages_read_user_content permissions
#   3. Generate a long-lived Page Access Token for the 1HeroWay page
#      (use the Graph API Explorer or Token Debugger to extend it to ~60 days,
#      then exchange it for a never-expiring token)
#
# The numeric ID for the page (find via: graph.facebook.com/1HeroWay?fields=id)
FACEBOOK_PAGE_ID=your-numeric-page-id

# Long-lived (or never-expiring) Page Access Token for the 1HeroWay page.
# SERVER-SIDE ONLY — never expose in client code.
FACEBOOK_PAGE_ACCESS_TOKEN=your-page-access-token


# ------------------------------------------------------------------------------
# 10. Cloudflare Turnstile (Contact Form Captcha)
# ------------------------------------------------------------------------------
# Used by the public /contact form and the legacy home page contact form to
# block spam/bot submissions. The widget is the simple "I'm not a robot"
# checkbox style. Server verification happens in /api/contact.
#
# Get keys from: dash.cloudflare.com > Turnstile > Add Site (Managed widget).
#
# For local development you can use Cloudflare's always-pass test keys:
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
#   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
#
# If both vars are LEFT BLANK, the widget is hidden and server verification
# is skipped — the form still works (intended only for local dev without a key).
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key
TURNSTILE_SECRET_KEY=your-turnstile-secret-key


# ------------------------------------------------------------------------------
# 11. Cron Secret (Scheduled Background Jobs)
# ------------------------------------------------------------------------------
# A shared secret used to authenticate HTTP requests from pg_cron to Next.js
# API routes (e.g. /api/social/refresh). Must match the `cron_secret` value
# stored in the system_settings table.
# Generate: openssl rand -hex 32
CRON_SECRET=your-cron-secret


# ------------------------------------------------------------------------------
# 12. Google Places API (Address Autocomplete)
# ------------------------------------------------------------------------------
# Used by the Add Location panel in the admin area to search for real addresses
# and auto-fill the location form. Calls go through server-side proxy routes
# (/api/places/autocomplete and /api/places/details) so this key is NEVER
# exposed to the browser.
#
# How to get this key:
#   1. Go to console.cloud.google.com and create or select a project.
#   2. Enable the "Places API" product.
#   3. Create an API key under APIs & Services > Credentials.
#   4. Restrict the key to "IP addresses" (set to your server IP or Amplify
#      outbound range) and restrict it to the Places API only.
#
# Cost: The first $200/month is free. At admin-only usage volumes this will
# realistically cost nothing.
#
# If this variable is not set, address search is hidden and the form falls back
# to manual entry with no error shown to the user.
GOOGLE_PLACES_API_KEY=your-google-places-api-key

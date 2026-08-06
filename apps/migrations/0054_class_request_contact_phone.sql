-- Migration 0054: Add contact_phone to class_requests
-- Nullable so existing rows without a phone number remain valid.
ALTER TABLE class_requests ADD COLUMN IF NOT EXISTS contact_phone TEXT;

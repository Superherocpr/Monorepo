-- Migration 0031: Promo code scope expansion
--
-- Adds a 'scope' field to promo_codes and a new promo_code_class_types junction
-- table so codes can be valid for all sessions, specific class types, or
-- specific individual sessions (the original behavior, now explicit).
--
-- scope enum:
--   all          — valid for any session site-wide
--   session_type — valid for any session of the linked class types
--   session      — valid only for the explicitly linked class_sessions (original)
--
-- Existing rows default to 'session' — preserves existing behaviour.

create type promo_scope as enum ('all', 'session_type', 'session');

alter table promo_codes
  add column scope promo_scope not null default 'session';

create table promo_code_class_types (
  id            uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references promo_codes(id) on delete cascade,
  class_type_id uuid not null references class_types(id) on delete cascade,
  constraint promo_code_class_types_unique unique (promo_code_id, class_type_id)
);

create index on promo_code_class_types (promo_code_id);
create index on promo_code_class_types (class_type_id);

alter table promo_code_class_types enable row level security;

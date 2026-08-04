-- Migration 0035: Add-ons
--
-- Purchasable extras tied to class types (e.g. extra card, gear rental).
-- Two tables:
--   addons             — global catalog, admin-owned (name, description, price, active)
--   addon_class_types  — junction: super admin decides which add-ons are eligible
--                        for which class types
--
-- Session-level opt-in (which of a class type's eligible add-ons an instructor
-- actually offers on a given session) and customer selection at checkout are
-- deferred to a later migration — this one only covers admin catalog management.
--
-- All access is via service-role (server-side only); no public RLS policies yet.
-- RLS is enabled to prevent anon/authenticated role bypass.

create table addons (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  price        numeric(10, 2) not null default 0 check (price >= 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),

  constraint addons_name_unique unique (name)
);

create table addon_class_types (
  id            uuid primary key default gen_random_uuid(),
  addon_id      uuid not null references addons(id) on delete cascade,
  class_type_id uuid not null references class_types(id) on delete cascade,
  constraint addon_class_types_unique unique (addon_id, class_type_id)
);

create index on addon_class_types (addon_id);
create index on addon_class_types (class_type_id);

alter table addons enable row level security;
alter table addon_class_types enable row level security;

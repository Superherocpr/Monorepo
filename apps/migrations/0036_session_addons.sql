-- Migration 0036: Session-level add-on opt-in
--
-- Instructors choose which of a class type's eligible add-ons (addon_class_types,
-- migration 0035) are actually offered on a specific session — not every session
-- of a class type has to offer the same add-ons.
--
-- session_addons — junction: session_id + addon_id
--
-- Customer selection/purchase of these add-ons at checkout is still deferred to
-- a later migration — this one only covers instructor-side session opt-in.
--
-- All access is via service-role (server-side only); no public RLS policies yet.
-- RLS is enabled to prevent anon/authenticated role bypass.

create table session_addons (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_sessions(id) on delete cascade,
  addon_id   uuid not null references addons(id) on delete cascade,
  constraint session_addons_unique unique (session_id, addon_id)
);

create index on session_addons (session_id);
create index on session_addons (addon_id);

alter table session_addons enable row level security;

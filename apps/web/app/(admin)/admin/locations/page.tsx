/**
 * Admin Locations page — `/admin/locations`
 * Access: manager and super_admin only.
 * Fetches the initial 10 locations with linked session counts, then passes
 * data to LocationsClient for add, edit, delete, and home base toggle actions.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LocationsClient, {
  type LocationWithCount,
} from "@/app/(admin)/_components/LocationsClient";

/** Server component — handles auth and data fetching. */
export default async function LocationsPage() {
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    (profile.role !== "manager" && profile.role !== "super_admin")
  ) {
    redirect("/admin");
  }

  // ── Fetch initial 10 locations only ─────────────────────────────────────────
  // Important: this query is capped at the database layer to avoid loading the
  // entire locations table on first render.
  const { data: raw, error } = await supabase
    .from("locations")
    .select(
      `
      id, name, address, city, state, zip,
      notes, is_home_base, created_at,
      class_sessions ( id )
    `
    )
    .order("is_home_base", { ascending: false })
    .order("name", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[LocationsPage] Failed to fetch locations", error);
  }

  const locations: LocationWithCount[] = (raw ?? [])
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      notes: loc.notes ?? null,
      is_home_base: loc.is_home_base,
      created_at: loc.created_at,
      sessionCount: Array.isArray(loc.class_sessions)
        ? loc.class_sessions.length
        : 0,
    }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <LocationsClient initialLocations={locations} />
    </main>
  );
}

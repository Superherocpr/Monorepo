/**
 * GET /admin/sessions/new
 * Access: All staff roles (instructor, manager, super_admin).
 *
 * Fetches the option lists needed to populate the create-session form:
 * active class types, all locations, and active staff profiles (for
 * manager/super admin instructor selector). Instructors always create
 * sessions for themselves — the instructor selector is hidden for them.
 * Renders the form via CreateSessionClient.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import type { UserRole } from "@/types/users";
import CreateSessionClient, {
  type ClassTypeOption,
  type LocationOption,
  type InstructorOption,
  type AddonOption,
} from "./_components/CreateSessionClient";

/** Staff roles allowed to create sessions. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "manager", "super_admin"];

/**
 * Server component — authenticates the user, fetches form option data,
 * and renders the CreateSessionClient form.
 */
export default async function NewSessionPage() {
  // Auth guard — honors view-as: a downgraded super admin gets the instructor
  // variant of the form (own name locked in, no instructor selector).
  const actor = await getAdminActor();
  if (!actor || !ALLOWED_ROLES.includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  const profile = actor.profile;
  const isInstructor = actor.effectiveRole === "instructor";

  const admin = await createAdminClient();

  // The instructor's own full name — passed to the form so it can display a
  // read-only "Instructor" row in place of the selector when isInstructor is true.
  const instructorName = isInstructor
    ? `${profile.first_name as string} ${profile.last_name as string}`.trim()
    : undefined;

  // ── Fetch active class types ───────────────────────────────────────────────
  const { data: rawClassTypes } = await admin
    .from("class_types")
    .select("id, name, duration_minutes, max_capacity, price")
    .eq("active", true)
    .order("name");

  // ── Fetch the add-on catalog + per-class-type eligibility (migration 0035/0036) ──
  // Defensive: if these migrations haven't been applied yet, fall back to empty so
  // the rest of the create-session form still renders (same reasoning as the
  // settings page's payout-settings fallback).
  let addons: AddonOption[] = [];
  let addonIdsByClassType = new Map<string, string[]>();
  try {
    const [{ data: addonRows }, { data: junctionRows }] = await Promise.all([
      admin.from("addons").select("id, name, price").eq("active", true).order("name"),
      admin.from("addon_class_types").select("addon_id, class_type_id"),
    ]);
    addons = (addonRows ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      price: Number(a.price ?? 0),
    }));
    const byClassType = new Map<string, string[]>();
    for (const j of (junctionRows ?? []) as { addon_id: string; class_type_id: string }[]) {
      byClassType.set(j.class_type_id, [...(byClassType.get(j.class_type_id) ?? []), j.addon_id]);
    }
    addonIdsByClassType = byClassType;
  } catch {
    // Suppress — defaults above are safe
  }

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    duration_minutes: t.duration_minutes as number,
    max_capacity: t.max_capacity as number,
    price: Number(t.price ?? 0),
    addon_ids: addonIdsByClassType.get(t.id as string) ?? [],
  }));

  // ── Fetch all locations ────────────────────────────────────────────────────
  const { data: rawLocations } = await admin
    .from("locations")
    .select("id, name, address, city, state")
    .order("name");

  const locations: LocationOption[] = (rawLocations ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    address: l.address as string,
    city: l.city as string,
    state: l.state as string,
  }));

  // ── Fetch instructor list (manager/super admin only) ───────────────────────
  let instructors: InstructorOption[] = [];
  if (!isInstructor) {
    const { data: rawInstructors } = await admin
      .from("profiles")
      .select("id, first_name, last_name")
      .in("role", ["instructor", "manager", "super_admin"])
      .eq("deactivated", false)
      .order("first_name");

    instructors = (rawInstructors ?? []).map((i) => ({
      id: i.id as string,
      first_name: i.first_name as string,
      last_name: i.last_name as string,
    }));
  }

  // Suspense boundary is required: CreateSessionClient reads useSearchParams()
  // to pre-fill the team form when arriving from "Convert to team booking".
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto py-8 px-4 text-sm text-gray-500">Loading…</div>}>
      <CreateSessionClient
        classTypes={classTypes}
        locations={locations}
        instructors={instructors}
        addons={addons}
        isInstructor={isInstructor}
        instructorName={instructorName}
      />
    </Suspense>
  );
}

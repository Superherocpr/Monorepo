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

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import CreateSessionClient, {
  type ClassTypeOption,
  type LocationOption,
  type InstructorOption,
} from "./_components/CreateSessionClient";

/** Staff roles allowed to create sessions. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "manager", "super_admin"];

/**
 * Server component — authenticates the user, fetches form option data,
 * and renders the CreateSessionClient form.
 */
export default async function NewSessionPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/sessions/new");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, first_name, last_name")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  const isInstructor = profile.role === "instructor";

  // The instructor's own full name — passed to the form so it can display a
  // read-only "Instructor" row in place of the selector when isInstructor is true.
  const instructorName = isInstructor
    ? `${profile.first_name as string} ${profile.last_name as string}`.trim()
    : undefined;

  // ── Fetch active class types ───────────────────────────────────────────────
  const { data: rawClassTypes } = await supabase
    .from("class_types")
    .select("id, name, duration_minutes, max_capacity")
    .eq("active", true)
    .order("name");

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    duration_minutes: t.duration_minutes as number,
    max_capacity: t.max_capacity as number,
  }));

  // ── Fetch all locations ────────────────────────────────────────────────────
  const { data: rawLocations } = await supabase
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
    const { data: rawInstructors } = await supabase
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

  return (
    <CreateSessionClient
      classTypes={classTypes}
      locations={locations}
      instructors={instructors}
      isInstructor={isInstructor}
      instructorName={instructorName}
    />
  );
}

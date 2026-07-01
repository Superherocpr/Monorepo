/**
 * GET /admin/sessions/bulk
 * Access: All staff roles (instructor, manager, super_admin).
 *
 * Fetches the option lists needed to populate the bulk session-creation form:
 * active class types, all locations, and active staff profiles (for the
 * manager/super admin instructor selector). Renders the form via
 * BulkCreateSessionClient.
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import BulkCreateSessionClient from "./_components/BulkCreateSessionClient";
import type {
  ClassTypeOption,
  LocationOption,
  InstructorOption,
} from "../new/_components/CreateSessionClient";

/** Staff roles allowed to create sessions. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "manager", "super_admin"];

/**
 * Server component — authenticates the user, fetches form option data,
 * and renders the BulkCreateSessionClient form.
 */
export default async function BulkSessionPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  const admin = await createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/sessions/bulk");

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, first_name, last_name")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  const isInstructor = profile.role === "instructor";

  const instructorName = isInstructor
    ? `${profile.first_name as string} ${profile.last_name as string}`.trim()
    : undefined;

  // ── Fetch active class types ───────────────────────────────────────────────
  const { data: rawClassTypes } = await admin
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

  return (
    <BulkCreateSessionClient
      classTypes={classTypes}
      locations={locations}
      instructors={instructors}
      isInstructor={isInstructor}
      instructorName={instructorName}
    />
  );
}

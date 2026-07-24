/**
 * Admin grading tool page — /admin/sessions/[id]/grades
 * Server component: verifies access, fetches session info, roster records, and preset grades.
 * Access: instructor (own session) and super admin only. No other roles.
 * Auth guard provided by app/(admin)/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import GradingClient, {
  type GradingStudent,
  type PresetGrade,
  type GradingSessionInfo,
} from "../../../../_components/GradingClient";
import type { UserRole } from "@/types/users";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Fetches all grading data and renders GradingClient. */
export default async function GradesPage({ params }: PageProps) {
  const { id } = await params;

  // Auth guard — honors view-as; ownership check below uses the effective role.
  const actor = await getAdminActor();
  if (!actor) redirect(`/signin?redirect=/admin/sessions/${id}/grades`);

  const user = actor.user;
  const role = actor.effectiveRole;

  // Only instructors and super admins may access the grading tool
  if (role !== "instructor" && role !== "super_admin") {
    redirect("/admin/sessions");
  }

  const admin = await createAdminClient();

  // Fetch session info to verify access and populate the page header
  const { data: rawSession } = await admin
    .from("class_sessions")
    .select(
      `id, starts_at, status, instructor_id,
       class_types ( name ),
       locations ( name )`
    )
    .eq("id", id)
    .single();

  if (!rawSession) redirect("/admin/sessions");

  // Instructors may only grade their own sessions
  if (role === "instructor" && rawSession.instructor_id !== user.id) {
    redirect("/admin/sessions");
  }

  const session: GradingSessionInfo = {
    id: rawSession.id,
    starts_at: rawSession.starts_at,
    status: rawSession.status as GradingSessionInfo["status"],
    class_types: rawSession.class_types as unknown as { name: string } | null,
    locations: rawSession.locations as unknown as { name: string } | null,
  };

  // Fetch roster records — grading source is roster_records only, not bookings
  const { data: rawStudents } = await admin
    .from("roster_records")
    .select("id, first_name, last_name, email, employer, grade, ccf_compression")
    .eq("session_id", id)
    .order("last_name");

  const students: GradingStudent[] = (rawStudents ?? []) as GradingStudent[];

  // Fetch preset grades for the grade selector buttons
  const { data: rawPresets } = await admin
    .from("preset_grades")
    .select("id, value, label")
    .order("value");

  const presetGrades: PresetGrade[] = (rawPresets ?? []) as PresetGrade[];

  return (
    <GradingClient
      session={session}
      students={students}
      presetGrades={presetGrades}
    />
  );
}

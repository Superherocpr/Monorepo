/**
 * Admin sessions list page — /admin/sessions
 * Shows all class sessions grouped by month.
 * Instructors see only their own sessions. Managers and super admins see all.
 * Data is fetched server-side; filtering is handled by SessionsClient.
 * Used by: admin sidebar nav for all staff roles.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SessionsClient from "../../_components/SessionsClient";
import type { SessionApprovalStatus, SessionStatus } from "@/types/schedule";
import type { UserRole } from "@/types/users";

/** A session row as returned by the Supabase query with joined relations. */
export interface SessionWithMeta {
  id: string;
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
  approval_status: SessionApprovalStatus;
  rejection_reason: string | null;
  max_capacity: number;
  created_at: string;
  spotsRemaining: number;
  class_types: { id: string; name: string } | null;
  locations: { name: string } | null;
  /** Instructor profile — populated for manager/super admin views. */
  instructor: { id: string; first_name: string; last_name: string } | null;
}

/** An instructor entry for the filter dropdown (manager/super admin only). */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

/** Fetches data and renders the sessions list via SessionsClient. */
export default async function SessionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/sessions");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;
  const isInstructor = role === "instructor";

  // Build the sessions query — instructors only see their own sessions
  let query = supabase
    .from("class_sessions")
    .select(
      `id, starts_at, ends_at, status, approval_status,
       rejection_reason, max_capacity, created_at,
       class_types ( id, name ),
       profiles!class_sessions_instructor_id_fkey ( id, first_name, last_name ),
       locations ( name ),
       bookings ( id, cancelled )`
    )
    .order("starts_at", { ascending: true });

  if (isInstructor) {
    query = query.eq("instructor_id", user.id);
  }

  const { data: rawSessions } = await query;

  // Compute spots remaining per session from non-cancelled bookings
  const sessions: SessionWithMeta[] = (rawSessions ?? []).map((s) => {
    const bookings = s.bookings as Array<{ id: string; cancelled: boolean }>;
    const enrolled = bookings.filter((b) => !b.cancelled).length;
    const instructor = s.profiles as {
      id: string;
      first_name: string;
      last_name: string;
    } | null;

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: s.status as SessionStatus,
      approval_status: s.approval_status as SessionApprovalStatus,
      rejection_reason: s.rejection_reason ?? null,
      max_capacity: s.max_capacity,
      created_at: s.created_at,
      spotsRemaining: s.max_capacity - enrolled,
      class_types: s.class_types as { id: string; name: string } | null,
      locations: s.locations as { name: string } | null,
      instructor,
    };
  });

  // Fetch instructor list for filter dropdown — manager/super admin only
  let instructors: InstructorOption[] = [];
  if (!isInstructor) {
    const { data: rawInstructors } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("role", ["instructor", "manager", "super_admin"])
      .eq("deactivated", false)
      .order("first_name");
    instructors = (rawInstructors ?? []) as InstructorOption[];
  }

  return (
    <SessionsClient
      sessions={sessions}
      instructors={instructors}
      userRole={role}
      userId={user.id}
    />
  );
}

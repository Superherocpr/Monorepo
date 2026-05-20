/**
 * Admin session detail page — /admin/sessions/[id]
 * Server component: fetches full session data, validates access, passes to SessionDetailClient.
 * Instructors can only view their own sessions. Managers and super admins see all.
 * Auth guard is provided by app/(admin)/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SessionDetailClient, {
  type SessionDetailData,
  type ClassTypeOption,
  type LocationOption,
  type InstructorOption,
} from "../../../_components/SessionDetailClient";
import type { UserRole } from "@/types/users";
import type { SessionStatus, SessionApprovalStatus } from "@/types/schedule";

/** Props passed to Next.js dynamic route pages. */
interface PageProps {
  params: Promise<{ id: string }>;
}

/** Fetches session detail and renders the interactive client view. */
export default async function SessionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/signin?redirect=/admin/sessions/${id}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;

  // Fetch the full session with all related data needed to render the detail page
  const { data: raw } = await supabase
    .from("class_sessions")
    .select(
      `
      id, starts_at, ends_at, status, approval_status,
      rejection_reason, max_capacity, notes,
      enrollware_submitted, roster_imported,
      correction_window_closes_at,
      class_type_id, instructor_id, location_id,
      class_types ( id, name, price, duration_minutes ),
      profiles!class_sessions_instructor_id_fkey ( id, first_name, last_name ),
      locations ( id, name, address, city, state, zip ),
      bookings (
        id, cancelled, booking_source, grade,
        profiles!bookings_customer_id_fkey ( first_name, last_name, email, phone ),
        payments ( status, payment_type, amount )
      ),
      roster_records (
        id, first_name, last_name, email, phone, employer, grade, confirmed
      ),
      invoices (
        id, invoice_number, invoice_type, recipient_name,
        recipient_email, company_name, student_count,
        total_amount, status, created_at
      ),
      roster_uploads (
        id, original_filename, submitted_by_name,
        submitted_by_email, imported, created_at
      )
    `
    )
    .eq("id", id)
    .single();

  // Session not found — send back to list
  if (!raw) redirect("/admin/sessions");

  // Instructors may only view their own sessions
  if (role === "instructor" && raw.instructor_id !== user.id) {
    redirect("/admin/sessions");
  }

  // Cast the raw Supabase response into the typed shape expected by the client component
  const session: SessionDetailData = {
    id: raw.id,
    starts_at: raw.starts_at,
    ends_at: raw.ends_at,
    status: raw.status as SessionStatus,
    approval_status: raw.approval_status as SessionApprovalStatus,
    rejection_reason: raw.rejection_reason ?? null,
    max_capacity: raw.max_capacity,
    notes: raw.notes ?? null,
    enrollware_submitted: raw.enrollware_submitted,
    roster_imported: raw.roster_imported,
    correction_window_closes_at: raw.correction_window_closes_at ?? null,
    class_type_id: raw.class_type_id,
    instructor_id: raw.instructor_id,
    location_id: raw.location_id,
    class_types: raw.class_types as unknown as SessionDetailData["class_types"],
    instructor: raw.profiles as unknown as SessionDetailData["instructor"],
    locations: raw.locations as unknown as SessionDetailData["locations"],
    bookings: (raw.bookings as unknown as SessionDetailData["bookings"]) ?? [],
    roster_records:
      (raw.roster_records as SessionDetailData["roster_records"]) ?? [],
    invoices: (raw.invoices as SessionDetailData["invoices"]) ?? [],
    roster_uploads:
      (raw.roster_uploads as SessionDetailData["roster_uploads"]) ?? [],
  };

  // Fetch class types for the edit form dropdown (active types only)
  const { data: rawClassTypes } = await supabase
    .from("class_types")
    .select("id, name, price, duration_minutes")
    .eq("active", true)
    .order("name");

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []) as ClassTypeOption[];

  // Fetch all locations for the edit form dropdown
  const { data: rawLocations } = await supabase
    .from("locations")
    .select("id, name, address, city, state, zip")
    .order("name");

  const locations: LocationOption[] = (rawLocations ?? []) as LocationOption[];

  // Fetch active staff for the edit form — managers and super admins can reassign.
  // Any non-customer profile may be assigned as the session instructor.
  let instructors: InstructorOption[] = [];
  if (role === "manager" || role === "super_admin") {
    const { data: rawInstructors } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .neq("role", "customer")
      .eq("deactivated", false)
      .order("first_name");
    instructors = (rawInstructors ?? []) as InstructorOption[];
  }

  return (
    <SessionDetailClient
      session={session}
      userId={user.id}
      userRole={role}
      classTypes={classTypes}
      locations={locations}
      instructors={instructors}
    />
  );
}

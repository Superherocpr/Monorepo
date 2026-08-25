/**
 * Admin session detail page — /admin/sessions/[id]
 * Server component: fetches full session data, validates access, passes to SessionDetailClient.
 * Instructors can only view their own sessions. Managers and super admins see all.
 * Auth guard is provided by app/(admin)/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import SessionDetailClient, {
  type SessionDetailData,
  type ClassTypeOption,
  type LocationOption,
  type InstructorOption,
  type AddonOption,
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

  // Auth guard — honors view-as: the instructor ownership check below applies
  // to a downgraded super admin too.
  const actor = await getAdminActor();
  if (!actor) redirect(`/signin?redirect=/admin/sessions/${id}`);

  const user = actor.user;
  const role = actor.effectiveRole;

  const admin = await createAdminClient();

  // Fetch the full session with all related data needed to render the detail page
  const { data: raw } = await admin
    .from("class_sessions")
    .select(
      `
      id, starts_at, ends_at, status, approval_status,
      rejection_reason, max_capacity, notes, discount_percent,
      travel_fee, class_request_id,
      enrollware_submitted, roster_imported,
      correction_window_closes_at,
      class_type_id, instructor_id, location_id,
      assistant_instructor_id, assistant_name, additional_hours,
      class_types ( id, name, price, duration_minutes, requires_assistant_at_capacity ),
      profiles!class_sessions_instructor_id_fkey ( id, first_name, last_name ),
      assistant_instructor:profiles!class_sessions_assistant_instructor_id_fkey ( id, first_name, last_name ),
      locations ( id, name, address, city, state, zip ),
      bookings (
        id, cancelled, booking_source, grade,
        profiles!bookings_customer_id_fkey ( first_name, last_name, email, phone ),
        payments ( status, payment_type, amount ),
        student_documents ( id, file_name, file_url, content_type, created_at )
      ),
      roster_records (
        id, first_name, last_name, email, phone, employer, grade, confirmed,
        address_1, address_2, city, state, zip,
        student_documents ( id, file_name, file_url, content_type, created_at )
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

  // Instructors may only view their own sessions, EXCEPT open opportunities:
  // unassigned customer-requested sessions (class_request_id set, instructor_id
  // null), and cancelled sessions reopened for any instructor to claim
  // (status = 'cancelled', instructor_id null).
  const isUnassignedCustomerRequest = raw.class_request_id !== null && raw.instructor_id === null;
  const isOpenOpportunity = raw.status === "cancelled" && raw.instructor_id === null;
  if (
    role === "instructor" &&
    raw.instructor_id !== user.id &&
    !isUnassignedCustomerRequest &&
    !isOpenOpportunity
  ) {
    redirect("/admin/sessions");
  }

  // ── Add-ons eligible for this session's class type + the session's current
  // selections (migrations 0035/0036). Defensive: if not applied yet, fall back
  // to empty so the rest of the detail page still renders.
  let eligibleAddons: AddonOption[] = [];
  let sessionAddonIds: string[] = [];
  try {
    const [{ data: junctionRows }, { data: sessionAddonRows }] = await Promise.all([
      admin
        .from("addon_class_types")
        .select("addons ( id, name, price, active )")
        .eq("class_type_id", raw.class_type_id),
      admin.from("session_addons").select("addon_id").eq("session_id", id),
    ]);
    eligibleAddons = ((junctionRows ?? []) as unknown as { addons: { id: string; name: string; price: number; active: boolean } | null }[])
      .map((j) => j.addons)
      .filter((a): a is { id: string; name: string; price: number; active: boolean } => a !== null && a.active)
      .map((a) => ({ id: a.id, name: a.name, price: Number(a.price) }));
    sessionAddonIds = ((sessionAddonRows ?? []) as { addon_id: string }[]).map((r) => r.addon_id);
  } catch {
    // Suppress — defaults above are safe
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
    discount_percent: raw.discount_percent != null ? Number(raw.discount_percent) : null,
    travel_fee: raw.travel_fee != null ? Number(raw.travel_fee) : null,
    class_request_id: raw.class_request_id ?? null,
    enrollware_submitted: raw.enrollware_submitted,
    roster_imported: raw.roster_imported,
    correction_window_closes_at: raw.correction_window_closes_at ?? null,
    class_type_id: raw.class_type_id,
    instructor_id: raw.instructor_id,
    location_id: raw.location_id,
    assistant_instructor_id: raw.assistant_instructor_id ?? null,
    assistant_name: raw.assistant_name ?? null,
    additional_hours: raw.additional_hours ?? 0,
    addon_ids: sessionAddonIds,
    class_types: raw.class_types as unknown as SessionDetailData["class_types"],
    instructor: raw.profiles as unknown as SessionDetailData["instructor"],
    assistant_instructor: raw.assistant_instructor as unknown as SessionDetailData["assistant_instructor"],
    locations: raw.locations as unknown as SessionDetailData["locations"],
    bookings: (raw.bookings as unknown as SessionDetailData["bookings"]) ?? [],
    roster_records:
      (raw.roster_records as SessionDetailData["roster_records"]) ?? [],
    invoices: (raw.invoices as SessionDetailData["invoices"]) ?? [],
    roster_uploads:
      (raw.roster_uploads as SessionDetailData["roster_uploads"]) ?? [],
  };

  // Fetch class types for the edit form dropdown (active types only)
  const { data: rawClassTypes } = await admin
    .from("class_types")
    .select("id, name, price, duration_minutes")
    .eq("active", true)
    .order("name");

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []) as ClassTypeOption[];

  // Fetch all locations for the edit form dropdown
  const { data: rawLocations } = await admin
    .from("locations")
    .select("id, name, address, city, state, zip")
    .order("name");

  const locations: LocationOption[] = (rawLocations ?? []) as LocationOption[];

  // Fetch active staff for the edit form (reassignment, managers/super admins
  // only) and the assistant-instructor dropdown (all staff roles).
  // Any non-customer profile may be assigned as session instructor or assistant.
  const { data: rawInstructors } = await admin
    .from("profiles")
    .select("id, first_name, last_name")
    .neq("role", "customer")
    .eq("deactivated", false)
    .order("first_name");
  const instructors: InstructorOption[] = (rawInstructors ?? []) as InstructorOption[];

  return (
    <SessionDetailClient
      session={session}
      userId={user.id}
      userRole={role}
      classTypes={classTypes}
      locations={locations}
      instructors={instructors}
      eligibleAddons={eligibleAddons}
    />
  );
}

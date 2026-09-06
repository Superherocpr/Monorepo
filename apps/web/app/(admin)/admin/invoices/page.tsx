/**
 * GET /admin/invoices
 * Access: Instructor, Manager, Super Admin.
 * Instructors see only their own invoices. Managers and super admins see all.
 * Filtering (status, type, date, instructor, class) is handled client-side via InvoicesClient.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import InvoicesClient, {
  type InvoiceRow,
  type InstructorOption,
  type UninvoicedTeamBooking,
} from "../../_components/InvoicesClient";

/**
 * Fetches all staff profiles for the instructor filter dropdown.
 * Only called for manager/super_admin roles.
 * @param adminClient - Service-role Supabase client (bypasses RLS)
 * @returns Array of instructor profile stubs (id, first_name, last_name)
 */
async function fetchInstructors(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>
): Promise<InstructorOption[]> {
  // Any non-customer profile may own invoices — include all active staff roles.
  // Staff use 'deactivated', not 'archived' (which is for customers only).
  const { data } = await adminClient
    .from("profiles")
    .select("id, first_name, last_name")
    .neq("role", "customer")
    .eq("deactivated", false)
    .order("last_name", { ascending: true });
  return (data ?? []) as InstructorOption[];
}

/**
 * Grace window before a company team booking with no invoice is treated as a
 * problem rather than as work still in flight. Matches the 1-hour window used by
 * the `team_booking_company_no_invoice` SQL invariant and the nightly retry
 * sweep, so all three agree on what counts as unbilled.
 */
const UNINVOICED_GRACE_MS = 60 * 60 * 1000;

/** Raw shape of the uninvoiced team booking query, before number coercion. */
interface RawUninvoicedTeamBooking {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  total_price: number | string | null;
  created_at: string;
  session_id: string;
  class_sessions:
    | { starts_at: string; class_types: { name: string } | { name: string }[] | null }
    | { starts_at: string; class_types: { name: string } | { name: string }[] | null }[]
    | null;
}

/**
 * Loads company-paid team bookings that still have no invoice attached — money
 * the business agreed to bill and has not.
 *
 * Deliberately a plain async function rather than inline page code: it reads the
 * wall clock to apply the grace window, which is not allowed during a component
 * render (react-hooks/purity).
 *
 * Side effects: one read of team_bookings with its session joined.
 *
 * @param adminClient - Service-role Supabase client (bypasses RLS).
 * @returns Uninvoiced bookings, oldest problem first.
 */
async function fetchUninvoicedTeamBookings(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>
): Promise<UninvoicedTeamBooking[]> {
  const cutoff = new Date(Date.now() - UNINVOICED_GRACE_MS).toISOString();

  const { data } = await adminClient
    .from("team_bookings")
    .select(
      `id, company_name, contact_name, contact_email, total_price, created_at, session_id,
       class_sessions ( starts_at, class_types ( name ) )`
    )
    .eq("payment_mode", "company")
    .is("invoice_id", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true });

  return ((data ?? []) as unknown as RawUninvoicedTeamBooking[]).map((row) => {
    const session = Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions;
    const classType = session
      ? Array.isArray(session.class_types)
        ? session.class_types[0]
        : session.class_types
      : null;

    return {
      id: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      totalPrice: Number(row.total_price) || 0,
      createdAt: row.created_at,
      sessionId: row.session_id,
      className: classType?.name ?? "CPR Class",
      classStartsAt: session?.starts_at ?? null,
    };
  });
}

/**
 * Server component for the invoices list page.
 * Fetches invoices (scoped by role), passes them to InvoicesClient for filtering and display.
 */
export default async function InvoicesPage() {
  // Auth guard — honors view-as; scoping below follows the effective role.
  const actor = await getAdminActor();
  if (!actor) redirect("/signin?redirect=/admin/invoices");

  const profile = actor.profile;
  const role = actor.effectiveRole;

  // Inspectors have no access to invoices
  if (role === "inspector") redirect("/admin");

  const admin = await createAdminClient();

  // Build invoices query — instructors see only their own
  let query = admin
    .from("invoices")
    .select(`
      id, invoice_number, invoice_type, recipient_name,
      recipient_email, company_name, student_count,
      total_amount, status, payment_platform,
      custom_price, created_at, paid_at, cancelled_at,
      class_sessions (
        id, starts_at,
        class_types ( name )
      ),
      profiles ( id, first_name, last_name ),
      team_bookings ( id )
    `)
    .order("created_at", { ascending: false });

  if (role === "instructor") {
    query = query.eq("instructor_id", profile.id);
  }

  const { data: invoices } = await query;

  const isManager = role === "manager" || role === "super_admin";

  // Only manager+ sees the unbilled band: raising an invoice is a manager-gated
  // action, and a red "not invoiced" row an instructor cannot act on is noise.
  const [instructors, uninvoicedTeamBookings] = await Promise.all([
    isManager ? fetchInstructors(admin) : Promise.resolve<InstructorOption[]>([]),
    isManager ? fetchUninvoicedTeamBookings(admin) : Promise.resolve<UninvoicedTeamBooking[]>([]),
  ]);

  return (
    <main>
      <InvoicesClient
        invoices={(invoices ?? []) as unknown as InvoiceRow[]}
        instructors={instructors}
        userRole={role}
        uninvoicedTeamBookings={uninvoicedTeamBookings}
      />
    </main>
  );
}

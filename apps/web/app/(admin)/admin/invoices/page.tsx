/**
 * GET /admin/invoices
 * Access: Instructor, Manager, Super Admin.
 * Instructors see only their own invoices. Managers and super admins see all.
 * Filtering (status, type, date, instructor, class) is handled client-side via InvoicesClient.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import InvoicesClient, {
  type InvoiceRow,
  type InstructorOption,
} from "../../_components/InvoicesClient";

/**
 * Fetches all staff profiles for the instructor filter dropdown.
 * Only called for manager/super_admin roles.
 * @param supabase - Authenticated Supabase server client
 * @returns Array of instructor profile stubs (id, first_name, last_name)
 */
async function fetchInstructors(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<InstructorOption[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("role", "instructor")
    .eq("archived", false)
    .order("last_name", { ascending: true });
  return (data ?? []) as InstructorOption[];
}

/**
 * Server component for the invoices list page.
 * Fetches invoices (scoped by role), passes them to InvoicesClient for filtering and display.
 */
export default async function InvoicesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/invoices");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;

  // Inspectors have no access to invoices
  if (role === "inspector") redirect("/admin");

  // Build invoices query — instructors see only their own
  let query = supabase
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
      profiles ( first_name, last_name )
    `)
    .order("created_at", { ascending: false });

  if (role === "instructor") {
    query = query.eq("instructor_id", profile.id);
  }

  const { data: invoices } = await query;

  const instructors =
    role === "manager" || role === "super_admin"
      ? await fetchInstructors(supabase)
      : [];

  return (
    <main>
      <InvoicesClient
        invoices={(invoices ?? []) as InvoiceRow[]}
        instructors={instructors}
        userRole={role}
        userId={profile.id}
      />
    </main>
  );
}

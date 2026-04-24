/**
 * GET /admin/invoices/[id]
 * Access: Instructor (own invoice only), Manager (view only), Super Admin (full actions).
 * Fetches the full invoice with class, location, instructor, and activity log.
 * All actions (paid, resend, cancel) are handled client-side via InvoiceDetailClient.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import InvoiceDetailClient, {
  type InvoiceDetail,
} from "../../../_components/InvoiceDetailClient";

/** Page props — Next.js provides params as a Promise in App Router. */
interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Server component for the invoice detail page.
 * Fetches the invoice and all related data, enforces role-based access, then
 * delegates rendering and interactivity to InvoiceDetailClient.
 */
export default async function InvoiceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/signin?redirect=/admin/invoices/${id}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;

  // Inspectors have no access to invoices
  if (role === "inspector") redirect("/admin");

  const { data: invoice } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_type, recipient_name,
      recipient_email, company_name, student_count,
      amount_per_student, custom_price, total_amount,
      payment_platform, platform_invoice_id,
      status, notes, created_at, paid_at, cancelled_at,
      instructor_id,
      class_sessions (
        id, starts_at, ends_at,
        class_types ( name ),
        locations ( name, address, city, state, zip )
      ),
      profiles ( id, first_name, last_name ),
      invoice_activity_log (
        id, action, notes, created_at,
        profiles ( first_name, last_name )
      )
    `)
    .eq("id", id)
    .single();

  if (!invoice) redirect("/admin/invoices");

  // Instructors may only view their own invoices
  if (role === "instructor" && invoice.instructor_id !== profile.id) {
    redirect("/admin/invoices");
  }

  return (
    <main>
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-4 py-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold text-gray-900">
            {invoice.invoice_number}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Invoice detail</p>
        </div>
      </div>

      <InvoiceDetailClient
        invoice={invoice as unknown as InvoiceDetail}
        userRole={role}
        userId={profile.id}
      />
    </main>
  );
}

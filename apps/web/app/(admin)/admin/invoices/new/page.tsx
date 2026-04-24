/**
 * GET /admin/invoices/new
 * Access: Instructor and Super Admin only.
 *
 * Fetches the authenticated instructor's active payment account and their
 * upcoming approved class sessions with spot availability computed.
 * If no payment account exists (instructors only), renders a gate prompt
 * directing them to connect one first.
 * Super admins bypass the payment account gate.
 * Accepts a `?session=[id]` query param to pre-select a session.
 */

import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import CreateInvoiceClient, {
  type SessionOption,
  type InstructorOption,
} from "../../../_components/CreateInvoiceClient";

/** Page props — Next.js 15+ provides both params and searchParams as Promises. */
interface PageProps {
  searchParams: Promise<{ session?: string; instructor?: string }>;
}

/**
 * Server component for the Create Invoice page.
 * Handles auth, role gating, payment account check, and session data fetching.
 * Passes computed data to CreateInvoiceClient for the wizard UI.
 */
export default async function CreateInvoicePage({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const preSelectedSessionId = resolvedParams.session ?? null;
  // Super admin arrives with ?instructor=[id] after choosing from the instructor selector.
  const preSelectedInstructorId = resolvedParams.instructor ?? null;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/invoices/new");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role as UserRole;

  // Only instructors and super admins may create invoices
  if (role === "inspector" || role === "manager" || role === "customer") {
    redirect("/admin");
  }

  // ---------------------------------------------------------------------------
  // Super admin without instructor context — show instructor selector first.
  // Clicking an instructor navigates to ?instructor=[id], reloading with their sessions.
  // ---------------------------------------------------------------------------
  if (role === "super_admin" && !preSelectedSessionId && !preSelectedInstructorId) {
    const { data: allInstructors } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .eq("role", "instructor")
      .eq("deactivated", false)
      .order("last_name", { ascending: true });

    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <CreateInvoiceClient
          sessions={[]}
          preSelectedSessionId={null}
          userRole={role}
          instructorId={null}
          instructors={(allInstructors ?? []) as InstructorOption[]}
        />
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Resolve instructorId — path differs by role and entry-point context.
  // ---------------------------------------------------------------------------

  let instructorId: string;

  if (role === "instructor") {
    // Instructors need an active connected payment account before they can invoice.
    const { data: paymentAccount } = await supabase
      .from("instructor_payment_accounts")
      .select("id")
      .eq("instructor_id", profile.id)
      .eq("is_active", true)
      .single();

    if (!paymentAccount) {
      return (
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
          <CreditCard className="h-12 w-12 text-gray-400" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Connect a Payment Account First
            </h1>
            <p className="mt-2 max-w-md text-gray-500">
              You need to connect a payment account before you can send invoices.
              This is how your clients will pay you.
            </p>
          </div>
          <Link
            href="/admin/settings/payment"
            className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            Connect Payment Account
          </Link>
        </main>
      );
    }

    instructorId = profile.id;
  } else if (preSelectedSessionId) {
    // Super admin arrived via ?session=[id] (e.g. "Send Invoice" from session detail).
    // Derive the instructor from that specific session so the list is scoped to the right
    // instructor and the preselect works correctly.
    const { data: targetSession } = await supabase
      .from("class_sessions")
      .select("instructor_id")
      .eq("id", preSelectedSessionId)
      .single();

    if (!targetSession) redirect("/admin/sessions");
    instructorId = targetSession.instructor_id as string;
  } else {
    // Super admin arrived via ?instructor=[id] from the instructor selection step.
    instructorId = preSelectedInstructorId!;
  }

  // Fetch all approved sessions for this instructor (past and future).
  // Invoicing is not restricted to upcoming classes — instructors may invoice
  // after a class has already taken place, or on the day of the class.
  const { data: rawSessions } = await supabase
    .from("class_sessions")
    .select(`
      id, starts_at, ends_at, max_capacity,
      class_types ( id, name, price ),
      locations ( name, city, state ),
      bookings ( id, cancelled ),
      invoices ( id, student_count, status )
    `)
    .eq("instructor_id", instructorId)
    .eq("approval_status", "approved")
    .order("starts_at", { ascending: false });

  // Compute spots remaining for each session.
  // Active bookings AND pending/sent invoice student counts both consume capacity —
  // an unpaid invoice still reserves spots to prevent overbooking.
  const sessions: SessionOption[] = (rawSessions ?? []).map((s) => {
    const bookings = Array.isArray(s.bookings) ? s.bookings : [];
    const invoices = Array.isArray(s.invoices) ? s.invoices : [];

    const activeBookings = bookings.filter(
      (b: { cancelled: boolean }) => !b.cancelled
    ).length;

    const activeInvoiceStudents = invoices
      .filter((inv: { status: string }) => inv.status !== "cancelled")
      .reduce(
        (sum: number, inv: { student_count: number }) =>
          sum + inv.student_count,
        0
      );

    const spotsRemaining = s.max_capacity - activeBookings - activeInvoiceStudents;

    // Supabase returns FK joins as objects for one-to-one relationships
    const classType = Array.isArray(s.class_types)
      ? s.class_types[0]
      : s.class_types;
    const location = Array.isArray(s.locations)
      ? s.locations[0]
      : s.locations;

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      spotsRemaining: Math.max(0, spotsRemaining),
      class_types: {
        id: classType?.id ?? "",
        name: classType?.name ?? "Unknown Class",
        price: classType?.price ?? 0,
      },
      locations: {
        name: location?.name ?? "",
        city: location?.city ?? "",
        state: location?.state ?? "",
      },
    };
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <CreateInvoiceClient
        sessions={sessions}
        preSelectedSessionId={preSelectedSessionId}
        userRole={role}
        instructorId={instructorId}
        instructors={null}
      />
    </main>
  );
}

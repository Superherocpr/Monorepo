/**
 * GET /admin/invoices/new
 * Access: Instructor and Super Admin only.
 *
 * Fetches the authenticated instructor's payout setup and their
 * upcoming approved class sessions with spot availability computed.
 * If no payout email exists (instructors only), renders a gate prompt
 * directing them to save one first. Super admins bypass the payout gate.
 * Accepts a `?session=[id]` query param to pre-select a session.
 */

import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import CreateInvoiceClient, {
  type SessionOption,
  type InstructorOption,
} from "../../../_components/CreateInvoiceClient";

/** Page props: Next.js 15+ provides both params and searchParams as Promises. */
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

  // Auth guard: honors view-as; the wizard variant follows the effective role.
  const actor = await getAdminActor();
  if (!actor) redirect("/signin?redirect=/admin/invoices/new");

  const role = actor.effectiveRole;

  // Only instructors and super admins may create invoices
  if (role === "inspector" || role === "manager" || role === "customer") {
    redirect("/admin");
  }

  const admin = await createAdminClient();

  // paypal_payout_email isn't part of the shared actor profile: fetch it here.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, paypal_payout_email")
    .eq("id", actor.user.id)
    .single();

  if (!profile) redirect("/");

  // ---------------------------------------------------------------------------
  // Super admin without instructor context: show instructor selector first.
  // Clicking an instructor navigates to ?instructor=[id], reloading with their sessions.
  // ---------------------------------------------------------------------------
  if (role === "super_admin" && !preSelectedSessionId && !preSelectedInstructorId) {
    const { data: allInstructors } = await admin
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
          instructorId={null}
          instructors={(allInstructors ?? []) as InstructorOption[]}
        />
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Resolve instructorId: path differs by role and entry-point context.
  // ---------------------------------------------------------------------------

  let instructorId: string;

  if (role === "instructor") {
    // Instructors need a payout email before they can create invoices.
    if (!profile.paypal_payout_email) {
      return (
        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
          <CreditCard className="h-12 w-12 text-gray-400" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Add a Payout Email First
            </h1>
            <p className="mt-2 max-w-md text-gray-500">
              Save the PayPal email where SuperHeroCPR should send your instructor
              payouts before creating invoices.
            </p>
          </div>
          <Link
            href="/admin/profile/payment"
            className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            Set Up Payouts
          </Link>
        </main>
      );
    }

    instructorId = profile.id;
  } else if (preSelectedSessionId) {
    // Super admin arrived via ?session=[id] (e.g. "Send Invoice" from session detail).
    // Derive the instructor from that specific session so the list is scoped to the right
    // instructor and the preselect works correctly.
    const { data: targetSession } = await admin
      .from("class_sessions")
      .select("instructor_id")
      .eq("id", preSelectedSessionId)
      .single();

    if (!targetSession) redirect("/admin/sessions");
    instructorId = targetSession.instructor_id as string;
  } else {
    // Super admin arrived via ?instructor=[id] from the instructor selection step.
    // Validate the id against active instructors to prevent a confused wizard state.
    const { data: instructorCheck } = await admin
      .from("profiles")
      .select("id")
      .eq("id", preSelectedInstructorId)
      .eq("role", "instructor")
      .eq("deactivated", false)
      .single();

    if (!instructorCheck) redirect("/admin/invoices/new");
    instructorId = instructorCheck.id as string;
  }

  // Fetch all approved sessions for this instructor (past and future).
  // Invoicing is not restricted to upcoming classes: instructors may invoice
  // after a class has already taken place, or on the day of the class.
  const { data: rawSessions } = await admin
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
  // Active bookings AND pending/sent invoice student counts both consume capacity:
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
        instructorId={instructorId}
        instructors={null}
      />
    </main>
  );
}

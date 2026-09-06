/**
 * Admin Team Bookings page — /admin/team-bookings
 * Access: manager and super_admin only.
 *
 * The operator-facing view of corporate/group bookings, which had no admin
 * surface at all until 2026-09-05. Its reason for existing is the top row of
 * the list: company-paid bookings whose invoice never got raised. Those are
 * real money the business agreed to bill and did not, and before this page the
 * only way to see one was to run a SQL invariant by hand.
 *
 * Auth guard is also enforced by app/(admin)/layout.tsx; the redirect here
 * narrows it from "any staff" to manager+.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import TeamBookingsClient, {
  type TeamBookingRow,
} from "./_components/TeamBookingsClient";

export const metadata = {
  title: "Team Bookings | Admin | SuperHeroCPR",
};

/** Roles allowed to view and act on team bookings. */
const ALLOWED_ROLES = ["manager", "super_admin"] as const;

/**
 * Grace window before a company booking with no invoice counts as a problem
 * rather than as work still in flight. Matches the 1-hour window used by the
 * `team_booking_company_no_invoice` SQL invariant and the nightly retry sweep,
 * so all three agree on what "uninvoiced" means.
 */
const GRACE_MS = 60 * 60 * 1000;

/** Raw row shape as returned by PostgREST for the list query. */
interface RawTeamBooking {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  payment_mode: string;
  price_per_seat: number | string | null;
  total_price: number | string | null;
  invoice_id: string | null;
  share_token: string;
  created_at: string;
  class_sessions:
    | { starts_at: string; status: string; class_types: { name: string } | { name: string }[] | null }
    | { starts_at: string; status: string; class_types: { name: string } | { name: string }[] | null }[]
    | null;
  invoices: { invoice_number: string; status: string } | { invoice_number: string; status: string }[] | null;
}

/**
 * Unwraps a PostgREST embedded relation, which arrives as an object or as a
 * single-element array depending on how the join is inferred.
 * @param value - The embedded value from the query result.
 * @returns The single related row, or null.
 */
function one<T>(value: T | T[] | null): T | null {
  if (value === null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Loads every team booking and flags the company-paid ones that still owe an
 * invoice.
 *
 * Deliberately a plain async function rather than inline page code: it reads the
 * wall clock to apply the grace window, which is not allowed during a component
 * render (react-hooks/purity) and would make the page non-idempotent.
 *
 * Side effects: one read of team_bookings with its session and invoice joined.
 *
 * @returns Every team booking, newest first, shaped for the client component.
 */
async function loadTeamBookings(): Promise<TeamBookingRow[]> {
  const admin = await createAdminClient();

  const { data } = await admin
    .from("team_bookings")
    .select(
      `id, company_name, contact_name, contact_email, contact_phone,
       payment_mode, price_per_seat, total_price, invoice_id, share_token, created_at,
       class_sessions ( starts_at, status, class_types ( name ) ),
       invoices ( invoice_number, status )`
    )
    .order("created_at", { ascending: false });

  const now = Date.now();

  return ((data ?? []) as unknown as RawTeamBooking[]).map((row) => {
    const session = one(row.class_sessions);
    const invoice = one(row.invoices);
    const classType = session ? one(session.class_types) : null;

    return {
      id: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      paymentMode: row.payment_mode === "company" ? "company" : "per_seat",
      pricePerSeat: row.price_per_seat === null ? null : Number(row.price_per_seat),
      totalPrice: row.total_price === null ? null : Number(row.total_price),
      invoiceId: row.invoice_id,
      invoiceNumber: invoice?.invoice_number ?? null,
      invoiceStatus: invoice?.status ?? null,
      shareToken: row.share_token,
      createdAt: row.created_at,
      className: classType?.name ?? "CPR Class",
      classStartsAt: session?.starts_at ?? null,
      sessionStatus: session?.status ?? null,
      // Past the grace window with no invoice on a company booking: money the
      // business agreed to bill and hasn't. This is what the page exists for.
      needsInvoice:
        row.payment_mode === "company" &&
        row.invoice_id === null &&
        now - new Date(row.created_at).getTime() > GRACE_MS,
    };
  });
}

/** Page props including the optional ?filter= search param. */
interface PageProps {
  searchParams: Promise<{ filter?: string }>;
}

/** Admin team booking list page. */
export default async function TeamBookingsAdminPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const params = await searchParams;

  const actor = await getAdminActor();
  if (!actor || !(ALLOWED_ROLES as readonly string[]).includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  const bookings = await loadTeamBookings();

  return (
    <TeamBookingsClient
      bookings={bookings}
      initialFilter={params.filter === "uninvoiced" ? "uninvoiced" : "all"}
    />
  );
}

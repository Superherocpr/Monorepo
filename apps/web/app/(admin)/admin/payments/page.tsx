/**
 * Admin Payments page — `/admin/payments`
 * Access: manager and super_admin only.
 *
 * Server component — resolves URL search params to build a filtered,
 * paginated query against the payments table. Passes result + summary
 * stats + available instructors to PaymentsClient.
 *
 * Filter params: type, status, from, to, customer, instructor, page
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PaymentsClient, {
  type PaymentsPageData,
} from "@/app/(admin)/_components/PaymentsClient";

/** Allowed payment_type values — used for filtering. */
const VALID_TYPES = new Set([
  "online",
  "cash",
  "check",
  "deposit",
  "invoice",
]);

/** Allowed status values — used for filtering. */
const VALID_STATUSES = new Set(["completed", "pending", "failed"]);

const PAGE_SIZE = 50;

/** Page props — Next.js 15+ provides searchParams as a Promise. */
interface PageProps {
  searchParams: Promise<{
    type?: string;
    status?: string;
    from?: string;
    to?: string;
    customer?: string;
    instructor?: string;
    page?: string;
  }>;
}

/** Server component — handles auth, filtering, pagination, and summary stats. */
export default async function PaymentsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !actorProfile ||
    (actorProfile.role !== "manager" && actorProfile.role !== "super_admin")
  ) {
    redirect("/admin");
  }

  // ── Resolve filter params ──────────────────────────────────────────────────
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const typeFilter =
    sp.type && VALID_TYPES.has(sp.type) ? sp.type : null;
  const statusFilter =
    sp.status && VALID_STATUSES.has(sp.status) ? sp.status : null;
  const fromFilter = sp.from ?? null;
  const toFilter = sp.to ?? null;
  const customerFilter = sp.customer?.trim() ?? null;
  const instructorFilter = sp.instructor?.trim() ?? null;

  // ── Main paginated query ───────────────────────────────────────────────────
  // FK hints required:
  //   profiles!customer_id — payments.customer_id → profiles
  //   bookings!booking_id  — payments.booking_id → bookings
  //   profiles!logged_by   — payments.logged_by → profiles
  // The instructor filter is applied via the session's instructor_id after fetch
  // because Supabase doesn't support deep-join filters server-side cleanly.
  let query = supabase
    .from("payments")
    .select(
      `
      id, amount, status, payment_type,
      paypal_transaction_id, notes, created_at, logged_by,
      customer:profiles!customer_id (
        id, first_name, last_name, email
      ),
      booking:bookings!booking_id (
        id,
        class_sessions (
          starts_at,
          class_types ( name ),
          profiles!instructor_id ( first_name, last_name )
        )
      ),
      logged_by_profile:profiles!logged_by (
        first_name, last_name
      )
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // Apply safe filters
  if (typeFilter) query = query.eq("payment_type", typeFilter);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (fromFilter) query = query.gte("created_at", fromFilter);
  if (toFilter) query = query.lte("created_at", `${toFilter}T23:59:59`);

  // Customer name/email search — filter by customer_id via subquery isn't
  // supported, so we fetch with ilike on the join. We filter post-fetch for
  // customer and instructor since PostgREST can't filter on nested columns.
  const { data: rawPayments, count } = await query;

  // ── Post-fetch filters (nested column filters) ──────────────────────────────
  let payments = rawPayments ?? [];

  if (customerFilter) {
    const term = customerFilter.toLowerCase();
    payments = payments.filter((p) => {
      if (!p.customer) return false;
      const name =
        `${p.customer.first_name} ${p.customer.last_name}`.toLowerCase();
      const email = p.customer.email?.toLowerCase() ?? "";
      return name.includes(term) || email.includes(term);
    });
  }

  if (instructorFilter) {
    payments = payments.filter((p) => {
      const session = p.booking?.class_sessions;
      if (!session) return false;
      const instructor = session.profiles;
      if (!instructor) return false;
      const name =
        `${instructor.first_name} ${instructor.last_name}`.toLowerCase();
      return name.includes(instructorFilter.toLowerCase());
    });
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  // ── Monthly summary stats (unfiltered — this month only) ───────────────────
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();

  const { data: monthlyStats } = await supabase
    .from("payments")
    .select("amount, payment_type, status")
    .eq("status", "completed")
    .gte("created_at", startOfMonth);

  const onlineInvoiceTotal = (monthlyStats ?? [])
    .filter((p) => p.payment_type === "online" || p.payment_type === "invoice")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const cashCheckTotal = (monthlyStats ?? [])
    .filter(
      (p) =>
        p.payment_type === "cash" ||
        p.payment_type === "check" ||
        p.payment_type === "deposit"
    )
    .reduce((sum, p) => sum + Number(p.amount), 0);

  // ── Instructors list for filter dropdown ───────────────────────────────────
  const { data: instructors } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("role", "instructor")
    .eq("deactivated", false)
    .order("last_name", { ascending: true });

  const pageData: PaymentsPageData = {
    payments,
    totalCount: count ?? 0,
    totalPages,
    currentPage: page,
    onlineInvoiceTotal,
    cashCheckTotal,
    instructors: instructors ?? [],
    actorRole: actorProfile.role,
    actorId: user.id,
    filters: {
      type: typeFilter,
      status: statusFilter,
      from: fromFilter,
      to: toFilter,
      customer: customerFilter,
      instructor: instructorFilter,
    },
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PaymentsClient data={pageData} />
    </main>
  );
}

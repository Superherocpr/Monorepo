/**
 * GET /admin
 * Route: /admin
 * Auth: Staff only: layout.tsx enforces this.
 * Role-aware dashboard page. Fetches data in parallel via Promise.all based on
 * the logged-in user's role and renders the correct dashboard sub-component.
 * Fully server-rendered: no client components.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { assignFreshAccessCode } from "@/lib/access-code";
import { isSameBusinessDay } from "@/lib/business-time";
import InstructorDashboard from "../_components/dashboard/InstructorDashboard";
import type {
  TodaySession,
  PendingGradeSession,
  PendingInvoice,
  OpenOpportunity,
  ActivePromoCode,
} from "../_components/dashboard/InstructorDashboard";
import ManagerDashboard from "../_components/dashboard/ManagerDashboard";
import SuperAdminDashboard from "../_components/dashboard/SuperAdminDashboard";
import type { ActivityItem } from "../_components/dashboard/SuperAdminDashboard";
import type { LowStockVariant } from "../_components/dashboard/ManagerDashboard";

/**
 * Returns the UTC ISO boundaries for the current calendar day.
 * Note: uses UTC: class sessions stored as timestamptz. For US Eastern
 * time accuracy, a timezone-aware approach would be needed in the future.
 */
function getTodayUTCRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)).toISOString(),
  };
}

/**
 * Returns the UTC ISO boundaries for the start and end of the current calendar month.
 */
function getThisMonthUTCRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1)).toISOString(),
    end: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString(),
  };
}

/**
 * Transforms raw promo code rows from Supabase into ActivePromoCode props.
 * Resolves nested class type names and session labels from the joined data.
 * @param rows - Raw rows from the promo_codes query with nested joins
 */
function buildActivePromoCodes(rows: unknown[]): ActivePromoCode[] {
  return (rows as Record<string, unknown>[]).map((row) => {
    const scope = (row.scope as string ?? "session") as ActivePromoCode["scope"];

    // Extract class type names for session_type scope
    const classTypeLinks = Array.isArray(row.promo_code_class_types)
      ? (row.promo_code_class_types as Record<string, unknown>[])
      : [];
    const class_type_names = classTypeLinks.flatMap((link) => {
      const ct = link.class_types as { name?: string } | null;
      return ct?.name ? [ct.name] : [];
    });

    // Extract session labels for session scope
    const sessionLinks = Array.isArray(row.promo_code_sessions)
      ? (row.promo_code_sessions as Record<string, unknown>[])
      : [];
    const allSessionLabels = sessionLinks.flatMap((link) => {
      const s = link.class_sessions as {
        starts_at?: string;
        class_types?: { name?: string } | null;
        locations?: { name?: string } | null;
      } | null;
      if (!s?.starts_at) return [];
      const className = s.class_types?.name ?? "Class";
      const locName = s.locations?.name ?? "";
      const time = new Date(s.starts_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return [`${className}${locName ? `, ${locName}` : ""} · ${time}`];
    });

    const MAX_SESSION_LABELS = 3;
    const session_labels = allSessionLabels.slice(0, MAX_SESSION_LABELS);
    const overflow_count = Math.max(0, allSessionLabels.length - MAX_SESSION_LABELS);

    return {
      code: row.code as string,
      discount_type: row.discount_type as ActivePromoCode["discount_type"],
      discount_value:
        typeof row.discount_value === "number"
          ? row.discount_value
          : parseFloat(String(row.discount_value)),
      expires_at: (row.expires_at as string | null) ?? null,
      scope,
      class_type_names,
      session_labels,
      overflow_count,
    };
  });
}

/** Server-rendered role-aware admin dashboard. */
export default async function AdminDashboardPage() {
  // Layout handles the primary auth guard, but we re-check here as a safeguard
  // since this page fetches data. Honors view-as: the dashboard variant shown
  // matches the EFFECTIVE role.
  const actor = await getAdminActor();
  if (!actor) redirect("/signin?redirect=/admin");
  const user = actor.user;

  // Use the service-role admin client for all data queries. RLS policies grant
  // only per-user row access to authenticated sessions; admin dashboard needs
  // full table visibility across all customers, sessions, and transactions.
  const admin = await createAdminClient();

  // daily_access_code isn't part of the shared actor profile: fetch it here.
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, daily_access_code, access_code_generated_at")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  // Auto-generate a fresh code if none exists or the current one is from a
  // previous business day. Codes are valid for the whole Eastern calendar day
  // (matches verify-code), so the instructor always has a working code when
  // they open the dashboard.
  const codeIsStale =
    !profile.access_code_generated_at ||
    !isSameBusinessDay(new Date(profile.access_code_generated_at), new Date());

  let accessCode = profile.daily_access_code ?? null;
  let accessCodeGeneratedAt = profile.access_code_generated_at ?? null;

  if (codeIsStale) {
    // Shared helper: crypto-random code, retries on unique-index collision
    const { data: fresh } = await assignFreshAccessCode(admin, user.id);
    if (fresh) {
      accessCode = fresh.code;
      accessCodeGeneratedAt = fresh.generatedAt;
    }
  }

  const role = actor.effectiveRole;

  // ── Instructor Dashboard ────────────────────────────────────────────────────
  if (role === "instructor") {
    const today = getTodayUTCRange();

    const [
      { data: rawTodaySessions },
      { data: completedSessionsWithRoster },
      { data: pendingInvoices },
      { data: rawOpenOpportunities },
      { data: rawActivePromoCodes },
    ] = await Promise.all([
      admin
        .from("class_sessions")
        .select(
          "id, starts_at, ends_at, status, class_types ( name ), locations ( name )"
        )
        .eq("instructor_id", user.id)
        .eq("approval_status", "approved")
        .gte("starts_at", today.start)
        .lte("starts_at", today.end)
        .order("starts_at"),

      // Fetch completed sessions with their roster grades to compute ungraded counts
      admin
        .from("class_sessions")
        .select(
          "id, starts_at, class_types ( name ), roster_records ( id, grade )"
        )
        .eq("instructor_id", user.id)
        .eq("status", "completed"),

      admin
        .from("invoices")
        .select(
          "id, recipient_name, total_amount, created_at, class_sessions ( starts_at, class_types ( name ) )"
        )
        .eq("instructor_id", user.id)
        .eq("status", "sent")
        .order("created_at", { ascending: false }),

      // Cancelled sessions with no instructor yet: open for any instructor to claim
      admin
        .from("class_sessions")
        .select("id, starts_at, class_types ( name ), locations ( name, city )")
        .eq("status", "cancelled")
        .is("instructor_id", null)
        .order("starts_at"),

      // Active promo codes with scope details: instructors use this as a quick reference
      admin
        .from("promo_codes")
        .select(`
          code, discount_type, discount_value, expires_at, scope,
          promo_code_class_types ( class_types ( name ) ),
          promo_code_sessions ( class_sessions ( starts_at, class_types ( name ), locations ( name ) ) )
        `)
        .eq("active", true)
        .or("expires_at.is.null,expires_at.gt.now()")
        .order("expires_at", { ascending: true, nullsFirst: false }),
    ]);

    // Filter completed sessions down to those with at least one ungraded roster record
    const pendingGrades = (completedSessionsWithRoster ?? [])
      .filter((session) =>
        (
          session.roster_records as Array<{ id: string; grade: number | null }>
        ).some((r) => r.grade === null)
      )
      .map((session) => ({
        id: session.id,
        starts_at: session.starts_at,
        class_types: session.class_types as unknown as { name: string } | null,
        ungradedCount: (
          session.roster_records as Array<{ id: string; grade: number | null }>
        ).filter((r) => r.grade === null).length,
      }));

    return (
      <InstructorDashboard
        firstName={profile.first_name}
        todaySessions={
          (rawTodaySessions ?? []) as unknown as TodaySession[]
        }
        pendingGrades={pendingGrades}
        pendingInvoices={
          (pendingInvoices ?? []) as unknown as PendingInvoice[]
        }
        openOpportunities={
          (rawOpenOpportunities ?? []) as unknown as OpenOpportunity[]
        }
        dailyAccessCode={accessCode}
        dailyAccessCodeGeneratedAt={accessCodeGeneratedAt}
        activePromoCodes={buildActivePromoCodes(rawActivePromoCodes ?? [])}
      />
    );
  }

  // ── Manager + Super Admin shared data ──────────────────────────────────────
  if (role === "manager" || role === "super_admin") {
    const today = getTodayUTCRange();
    // Month range needed by the super_admin extra queries: must be computed here
    // so it is available when superAdminExtraPromise is created below.
    const month = getThisMonthUTCRange();

    // Fire the super_admin-only queries immediately so they run in parallel with
    // the shared batch below, cutting the super_admin page load from 2 serial
    // round-trips to 1. null for managers: they return before it is awaited.
    // IMPORTANT: any new role added to this block MUST return before the
    // `await superAdminExtraPromise!` line below, or that assertion will throw.
    const superAdminExtraPromise =
      role === "super_admin"
        ? Promise.all([
            admin
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "customer")
              .eq("archived", false),

            admin
              .from("class_sessions")
              .select("id", { count: "exact", head: true })
              .eq("approval_status", "approved")
              .gte("starts_at", month.start)
              .lte("starts_at", month.end),

            // Online booking payments this month
            admin
              .from("payments")
              .select("amount")
              .eq("payment_type", "online")
              .eq("status", "completed")
              .gte("created_at", month.start)
              .lte("created_at", month.end),

            // Paid invoices this month: invoice revenue is tracked separately from online
            admin
              .from("invoices")
              .select("total_amount")
              .eq("status", "paid")
              .gte("paid_at", month.start)
              .lte("paid_at", month.end),

            // Activity feed: recent bookings
            admin
              .from("bookings")
              .select(
                "id, created_at, profiles!bookings_customer_id_fkey ( first_name, last_name ), class_sessions ( class_types ( name ) )"
              )
              .order("created_at", { ascending: false })
              .limit(5),

            // Activity feed: recent payments. Must stay filtered to 'completed'
            //: failed attempts are also stored in this table and would
            // otherwise render as "X paid $Y", describing a decline as a sale.
            admin
              .from("payments")
              .select(
                "id, created_at, amount, profiles!payments_customer_id_fkey ( first_name, last_name )"
              )
              .eq("status", "completed")
              .order("created_at", { ascending: false })
              .limit(5),

            // Activity feed: recent failed payment attempts, so the owner sees
            // customers hitting payment trouble without waiting to be told.
            admin
              .from("payments")
              .select(
                "id, created_at, amount, notes, profiles!payments_customer_id_fkey ( first_name, last_name )"
              )
              .eq("status", "failed")
              .order("created_at", { ascending: false })
              .limit(5),

            // Activity feed: recent invoices
            admin
              .from("invoices")
              .select("id, created_at, recipient_name, total_amount")
              .order("created_at", { ascending: false })
              .limit(5),

            // Activity feed: new customers
            admin
              .from("profiles")
              .select("id, created_at, first_name, last_name")
              .eq("role", "customer")
              .order("created_at", { ascending: false })
              .limit(5),

            // Pending grades: all completed sessions system-wide with at least one ungraded
            // roster student: super_admins oversee all instructors
            admin
              .from("class_sessions")
              .select(
                "id, starts_at, class_types ( name ), roster_records ( id, grade )"
              )
              .eq("status", "completed"),

            // Pending invoices: all sent-but-unpaid invoices system-wide:
            // super_admins oversee all instructors
            admin
              .from("invoices")
              .select(
                "id, recipient_name, total_amount, created_at, class_sessions ( starts_at, class_types ( name ) )"
              )
              .eq("status", "sent")
              .order("created_at", { ascending: false }),
          ])
        : null;

    const [
      { count: pendingApprovalsCount },
      { data: rawTodaySessions },
      { data: rawRecentBookings },
      { count: unansweredContactCount },
      { data: rawLowStockVariants },
    ] = await Promise.all([
      admin
        .from("class_sessions")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending_approval"),

      // All approved sessions today across all instructors
      admin
        .from("class_sessions")
        .select(
          `id, starts_at, ends_at, max_capacity,
           class_types ( name ),
           locations ( name ),
           profiles!class_sessions_instructor_id_fkey ( first_name, last_name ),
           bookings ( id, cancelled )`
        )
        .eq("approval_status", "approved")
        .gte("starts_at", today.start)
        .lte("starts_at", today.end)
        .order("starts_at"),

      // Last 5 non-cancelled bookings with customer and session info
      admin
        .from("bookings")
        .select(
          `id, created_at, booking_source,
           profiles!bookings_customer_id_fkey ( first_name, last_name ),
           class_sessions ( starts_at, class_types ( name ) )`
        )
        .eq("cancelled", false)
        .order("created_at", { ascending: false })
        .limit(5),

      admin
        .from("contact_submissions")
        .select("id", { count: "exact", head: true })
        .eq("replied", false),

      // Product variants at or below their product's low_stock_threshold
      admin
        .from("product_variants")
        .select("id, size, stock_quantity, products ( id, name, low_stock_threshold )")
        .order("stock_quantity"),
    ]);

    // Derive enrolledCount from non-cancelled bookings per session
    const todaySessions = (rawTodaySessions ?? []).map((session) => {
      const bookings = session.bookings as Array<{
        id: string;
        cancelled: boolean;
      }>;
      const instructor = session.profiles as unknown as {
        first_name: string;
        last_name: string;
      } | null;
      return {
        id: session.id,
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        max_capacity: session.max_capacity,
        enrolledCount: bookings.filter((b) => !b.cancelled).length,
        class_types: session.class_types as unknown as { name: string } | null,
        locations: session.locations as unknown as { name: string } | null,
        instructor,
      };
    });

    // Normalize recent bookings: pick the correct FK-hinted profile
    const recentBookings = (rawRecentBookings ?? []).map((booking) => ({
      id: booking.id,
      created_at: booking.created_at,
      booking_source: booking.booking_source,
      customer: booking.profiles as unknown as {
        first_name: string;
        last_name: string;
      } | null,
      class_sessions: booking.class_sessions as unknown as {
        starts_at: string;
        class_types: { name: string } | null;
      } | null,
    }));

    // Filter low stock variants to those actually at or below threshold.
    // flatMap lets us cast v.products once per item instead of separately in filter+map.
    const lowStockVariants: LowStockVariant[] = (rawLowStockVariants ?? []).flatMap((v) => {
      const product = v.products as unknown as {
        id: string;
        name: string;
        low_stock_threshold: number;
      } | null;
      if (!product || v.stock_quantity > product.low_stock_threshold) return [];
      return [{
        id: v.id,
        size: v.size,
        stock_quantity: v.stock_quantity,
        product_id: product.id,
        product_name: product.name,
        low_stock_threshold: product.low_stock_threshold,
      }];
    });

    const managerProps = {
      firstName: profile.first_name,
      pendingApprovalsCount: pendingApprovalsCount ?? 0,
      todaySessions,
      recentBookings,
      unansweredContactCount: unansweredContactCount ?? 0,
      lowStockVariants,
    };

    if (role === "manager") {
      return <ManagerDashboard {...managerProps} />;
    }

    // ── Super Admin extra data ──────────────────────────────────────────────
    // superAdminExtraPromise was fired before the shared batch above.
    // It is guaranteed non-null here: manager returned early above.
    const [
      { count: totalCustomers },
      { count: classesThisMonth },
      { data: onlinePayments },
      { data: paidInvoices },
      { data: recentBookingsActivity },
      { data: recentPaymentsActivity },
      { data: recentFailedPaymentsActivity },
      { data: recentInvoicesActivity },
      { data: recentCustomersActivity },
      { data: completedSessionsForSuperAdmin },
      { data: rawPendingInvoicesForSuperAdmin },
    ] = await superAdminExtraPromise!;

    const onlineRevenueThisMonth = (onlinePayments ?? []).reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    const invoiceRevenueThisMonth = (paidInvoices ?? []).reduce(
      (sum, inv) => sum + Number(inv.total_amount),
      0
    );

    // Filter completed sessions to those with at least one ungraded roster student,
    // across all instructors: super_admins have full visibility
    const superAdminPendingGrades = (completedSessionsForSuperAdmin ?? [])
      .filter((session) =>
        (
          session.roster_records as Array<{ id: string; grade: number | null }>
        ).some((r) => r.grade === null)
      )
      .map((session) => ({
        id: session.id,
        starts_at: session.starts_at,
        class_types: session.class_types as unknown as { name: string } | null,
        ungradedCount: (
          session.roster_records as Array<{ id: string; grade: number | null }>
        ).filter((r) => r.grade === null).length,
      }));

    // Build and sort a unified activity feed from the four recent-activity queries
    const activityItems: ActivityItem[] = [
      ...(recentBookingsActivity ?? []).map((b) => {
        const customer = b.profiles as unknown as {
          first_name: string;
          last_name: string;
        } | null;
        const classSession = b.class_sessions as unknown as {
          class_types: { name: string } | null;
        } | null;
        return {
          id: b.id,
          type: "booking" as const,
          description: customer
            ? `${customer.first_name} ${customer.last_name} booked ${classSession?.class_types?.name ?? "a class"}`
            : "New booking",
          created_at: b.created_at,
        };
      }),
      ...(recentPaymentsActivity ?? []).map((p) => {
        const customer = p.profiles as unknown as {
          first_name: string;
          last_name: string;
        } | null;
        return {
          id: p.id,
          type: "payment" as const,
          description: customer
            ? `${customer.first_name} ${customer.last_name} paid $${Number(p.amount).toFixed(2)}`
            : `Payment of $${Number(p.amount).toFixed(2)}`,
          created_at: p.created_at,
        };
      }),
      ...(recentFailedPaymentsActivity ?? []).map((p) => {
        const customer = p.profiles as unknown as {
          first_name: string;
          last_name: string;
        } | null;
        const who = customer
          ? `${customer.first_name} ${customer.last_name}`
          : "A customer";
        return {
          id: p.id,
          type: "payment_failed" as const,
          description: `${who}: payment of $${Number(p.amount).toFixed(2)} failed${
            p.notes ? ` (${p.notes})` : ""
          }`,
          created_at: p.created_at,
        };
      }),
      ...(recentInvoicesActivity ?? []).map((inv) => ({
        id: inv.id,
        type: "invoice" as const,
        description: `Invoice sent to ${inv.recipient_name}: $${Number(inv.total_amount).toFixed(2)}`,
        created_at: inv.created_at,
      })),
      ...(recentCustomersActivity ?? []).map((c) => ({
        id: c.id,
        type: "customer" as const,
        description: `${c.first_name} ${c.last_name} joined`,
        created_at: c.created_at,
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, 10);

    return (
      <SuperAdminDashboard
        {...managerProps}
        quickStats={{
          totalCustomers: totalCustomers ?? 0,
          classesThisMonth: classesThisMonth ?? 0,
          onlineRevenueThisMonth,
          invoiceRevenueThisMonth,
        }}
        recentActivity={activityItems}
        dailyAccessCode={accessCode}
        dailyAccessCodeGeneratedAt={accessCodeGeneratedAt}
        pendingGrades={superAdminPendingGrades}
        pendingInvoices={
          (rawPendingInvoicesForSuperAdmin ?? []) as unknown as PendingInvoice[]
        }
      />
    );
  }

  // ── Inspector placeholder ──────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">
        Welcome, {profile.first_name}
      </h1>
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <p className="text-sm text-gray-500">
          Inspector view coming soon. You currently have read-only access.
        </p>
      </div>
    </div>
  );
}

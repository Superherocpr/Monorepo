/**
 * POST /admin (GET)
 * Route: /admin
 * Auth: Staff only — layout.tsx enforces this.
 * Role-aware dashboard page. Fetches data in parallel via Promise.all based on
 * the logged-in user's role and renders the correct dashboard sub-component.
 * Fully server-rendered — no client components.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InstructorDashboard from "../_components/dashboard/InstructorDashboard";
import ManagerDashboard from "../_components/dashboard/ManagerDashboard";
import SuperAdminDashboard from "../_components/dashboard/SuperAdminDashboard";
import type { ActivityItem } from "../_components/dashboard/SuperAdminDashboard";
import type { LowStockVariant } from "../_components/dashboard/ManagerDashboard";

/**
 * Returns the UTC ISO boundaries for the current calendar day.
 * Note: uses UTC — class sessions stored as timestamptz. For US Eastern
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

/** Server-rendered role-aware admin dashboard. */
export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Layout handles the primary auth guard, but we re-check here as a safeguard
  // since this page fetches data — a missing user would cause runtime errors.
  if (!user) redirect("/signin?redirect=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/");

  const role = profile.role;

  // ── Instructor Dashboard ────────────────────────────────────────────────────
  if (role === "instructor") {
    const today = getTodayUTCRange();

    const [
      { data: rawTodaySessions },
      { data: completedSessionsWithRoster },
      { data: pendingInvoices },
      { data: instructorProfile },
    ] = await Promise.all([
      supabase
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
      supabase
        .from("class_sessions")
        .select(
          "id, starts_at, class_types ( name ), roster_records ( id, grade )"
        )
        .eq("instructor_id", user.id)
        .eq("status", "completed"),

      supabase
        .from("invoices")
        .select(
          "id, recipient_name, total_amount, created_at, class_sessions ( starts_at, class_types ( name ) )"
        )
        .eq("instructor_id", user.id)
        .eq("status", "sent")
        .order("created_at", { ascending: false }),

      // Fetch daily_access_code separately in case it doesn't exist in older DB versions
      supabase
        .from("profiles")
        .select("daily_access_code")
        .eq("id", user.id)
        .single(),
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
          (rawTodaySessions ?? []) as unknown as Parameters<
            typeof InstructorDashboard
          >[0]["todaySessions"]
        }
        pendingGrades={pendingGrades}
        pendingInvoices={
          (pendingInvoices ?? []) as unknown as Parameters<
            typeof InstructorDashboard
          >[0]["pendingInvoices"]
        }
        dailyAccessCode={instructorProfile?.daily_access_code ?? null}
      />
    );
  }

  // ── Manager + Super Admin shared data ──────────────────────────────────────
  if (role === "manager" || role === "super_admin") {
    const today = getTodayUTCRange();

    const [
      { count: pendingApprovalsCount },
      { data: rawTodaySessions },
      { data: rawRecentBookings },
      { count: unansweredContactCount },
      { data: rawLowStockVariants },
    ] = await Promise.all([
      supabase
        .from("class_sessions")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending_approval"),

      // All approved sessions today across all instructors
      supabase
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
      supabase
        .from("bookings")
        .select(
          `id, created_at, booking_source,
           profiles!bookings_customer_id_fkey ( first_name, last_name ),
           class_sessions ( starts_at, class_types ( name ) )`
        )
        .eq("cancelled", false)
        .order("created_at", { ascending: false })
        .limit(5),

      supabase
        .from("contact_submissions")
        .select("id", { count: "exact", head: true })
        .eq("replied", false),

      // Product variants at or below their product's low_stock_threshold
      supabase
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

    // Normalize recent bookings — pick the correct FK-hinted profile
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

    // Filter low stock variants to those actually at or below threshold
    const lowStockVariants: LowStockVariant[] = (rawLowStockVariants ?? [])
      .filter((v) => {
        const product = v.products as unknown as {
          id: string;
          name: string;
          low_stock_threshold: number;
        } | null;
        return product && v.stock_quantity <= product.low_stock_threshold;
      })
      .map((v) => {
        const product = v.products as unknown as {
          id: string;
          name: string;
          low_stock_threshold: number;
        };
        return {
          id: v.id,
          size: v.size,
          stock_quantity: v.stock_quantity,
          product_id: product.id,
          product_name: product.name,
          low_stock_threshold: product.low_stock_threshold,
        };
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
    const month = getThisMonthUTCRange();

    const [
      { count: totalCustomers },
      { count: classesThisMonth },
      { data: onlinePayments },
      { data: paidInvoices },
      { data: recentBookingsActivity },
      { data: recentPaymentsActivity },
      { data: recentInvoicesActivity },
      { data: recentCustomersActivity },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "customer")
        .eq("archived", false),

      supabase
        .from("class_sessions")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "approved")
        .gte("starts_at", month.start)
        .lte("starts_at", month.end),

      // Online booking payments this month
      supabase
        .from("payments")
        .select("amount")
        .eq("payment_type", "online")
        .eq("status", "completed")
        .gte("created_at", month.start)
        .lte("created_at", month.end),

      // Paid invoices this month — invoice revenue is tracked separately from online
      supabase
        .from("invoices")
        .select("total_amount")
        .eq("status", "paid")
        .gte("paid_at", month.start)
        .lte("paid_at", month.end),

      // Activity feed: recent bookings
      supabase
        .from("bookings")
        .select(
          "id, created_at, profiles!bookings_customer_id_fkey ( first_name, last_name ), class_sessions ( class_types ( name ) )"
        )
        .order("created_at", { ascending: false })
        .limit(5),

      // Activity feed: recent payments
      supabase
        .from("payments")
        .select(
          "id, created_at, amount, profiles!payments_customer_id_fkey ( first_name, last_name )"
        )
        .order("created_at", { ascending: false })
        .limit(5),

      // Activity feed: recent invoices
      supabase
        .from("invoices")
        .select("id, created_at, recipient_name, total_amount")
        .order("created_at", { ascending: false })
        .limit(5),

      // Activity feed: new customers
      supabase
        .from("profiles")
        .select("id, created_at, first_name, last_name")
        .eq("role", "customer")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const onlineRevenueThisMonth = (onlinePayments ?? []).reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    const invoiceRevenueThisMonth = (paidInvoices ?? []).reduce(
      (sum, inv) => sum + Number(inv.total_amount),
      0
    );

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
      ...(recentInvoicesActivity ?? []).map((inv) => ({
        id: inv.id,
        type: "invoice" as const,
        description: `Invoice sent to ${inv.recipient_name} — $${Number(inv.total_amount).toFixed(2)}`,
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

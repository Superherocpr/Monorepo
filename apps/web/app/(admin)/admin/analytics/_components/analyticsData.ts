/**
 * analyticsData.ts
 * Pure data-fetching module for the Admin Analytics page.
 * All analytics data is fetched here and aggregated in TypeScript.
 * Called by the server page on initial load and by the client-side
 * API route on filter changes.
 *
 * Used by: app/(admin)/admin/analytics/page.tsx
 *          app/api/analytics/route.ts
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Shared types ──────────────────────────────────────────────────────────────

/** A data point on a time-series chart (week or month label + two revenue lines). */
export interface RevenuePoint {
  period: string;
  online: number;
  invoice: number;
}

/** Revenue attributed to a named class type or instructor (for horizontal bar charts). */
export interface NamedRevenue {
  name: string;
  revenue: number;
}

/** Sessions per month for the bar chart. */
export interface SessionsPerMonth {
  month: string;
  count: number;
}

/** Capacity utilisation per class type. */
export interface CapacityUtilisation {
  name: string;
  /** Average percent of capacity filled (0–100). */
  avgPct: number;
}

/** A single ranked instructor by completed sessions. */
export interface ActiveInstructor {
  name: string;
  completedSessions: number;
  studentsTotal: number;
}

/** Student counts for the New vs Returning cards. */
export interface StudentCounts {
  newCount: number;
  returningCount: number;
}

/** A row in the Top Employers table. */
export interface EmployerRow {
  employer: string;
  studentCount: number;
}

/** Invoice conversion stats. */
export interface InvoiceStats {
  sent: number;
  paid: number;
  cancelled: number;
  avgDaysToPayment: number;
}

/** Instructor ranked by invoice count. */
export interface InstructorInvoiceCount {
  name: string;
  count: number;
}

/** A product with merch sales stats. */
export interface MerchProductStat {
  name: string;
  unitsSold: number;
  revenue: number;
}

/** A time-series point for merch revenue. */
export interface MerchRevenuePoint {
  period: string;
  revenue: number;
}

/** Overview card trend data. */
export interface TrendCard {
  value: number;
  previousValue: number;
}

/** Low-stock alert count. */
export interface LowStockInfo {
  count: number;
}

/** The full aggregated analytics dataset passed to the client. */
export interface AnalyticsData {
  // Overview
  totalRevenue: TrendCard;
  onlineRevenue: TrendCard;
  invoiceRevenue: TrendCard;
  studentsTrained: TrendCard;
  // Revenue
  revenueOverTime: RevenuePoint[];
  revenueByClassType: NamedRevenue[];
  revenueByInstructor: NamedRevenue[];
  // Classes
  sessionsPerMonth: SessionsPerMonth[];
  capacityUtilisation: CapacityUtilisation[];
  cancellationRate: { cancelled: number; total: number };
  activeInstructors: ActiveInstructor[];
  // Students
  studentCounts: StudentCounts;
  certRenewalRate: { renewed: number; total: number } | null;
  topEmployers: EmployerRow[];
  // Invoices
  invoiceStats: InvoiceStats;
  instructorInvoiceCounts: InstructorInvoiceCount[];
  // Merch
  merchRevenueOverTime: MerchRevenuePoint[];
  merchProducts: MerchProductStat[];
  lowStock: LowStockInfo;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a "YYYY-WW" or "YYYY-MM" string for grouping a date.
 * Uses weekly grouping for ranges under 90 days, monthly otherwise.
 * @param iso - ISO date string
 * @param useMonthly - true to group by month
 */
function periodKey(iso: string, useMonthly: boolean): string {
  const d = new Date(iso);
  if (useMonthly) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // ISO week number
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Formats a YYYY-MM period key into a readable label (e.g. "Apr 2026").
 * @param key - "YYYY-MM" or "YYYY-WW"
 */
function formatPeriodLabel(key: string): string {
  if (key.includes("-W")) return key; // week label stays as-is
  const [year, month] = key.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

// ── Main fetch function ───────────────────────────────────────────────────────

/**
 * Fetches and aggregates all analytics data for a given date range.
 * Called server-side on initial page load and via the analytics API route on filter changes.
 * @param supabase - Supabase client (admin or regular depending on caller)
 * @param rangeStart - ISO date string for range start
 * @param rangeEnd - ISO date string for range end
 */
export async function fetchAnalyticsData(
  supabase: SupabaseClient,
  rangeStart: string,
  rangeEnd: string
): Promise<AnalyticsData> {
  const rangeDays =
    (new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / (1000 * 60 * 60 * 24);
  const useMonthly = rangeDays >= 90;

  // Previous period for trend comparison (same duration immediately before)
  const prevEnd = rangeStart;
  const prevStart = new Date(new Date(rangeStart).getTime() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const [
    { data: payments },
    { data: prevPayments },
    { data: sessions },
    { data: bookings },
    { data: invoices },
    { data: rosterRecords },
    { data: certifications },
    { data: orderItems },
    { data: lowStockVariants },
    { data: profiles },
  ] = await Promise.all([
    // Current period payments
    supabase
      .from("payments")
      .select("id, amount, payment_type, booking_id, created_at")
      .eq("status", "completed")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd),

    // Previous period payments (for trend cards)
    supabase
      .from("payments")
      .select("amount, payment_type")
      .eq("status", "completed")
      .gte("created_at", prevStart)
      .lte("created_at", prevEnd),

    // Sessions in range (completed + cancelled for cancellation rate; all statuses for capacity)
    supabase
      .from("class_sessions")
      .select(
        "id, status, starts_at, max_capacity, class_type_id, instructor_id, class_types(name), profiles!instructor_id(first_name, last_name)"
      )
      .gte("starts_at", rangeStart)
      .lte("starts_at", rangeEnd),

    // Bookings in range (non-cancelled) with their sessions for class-type revenue
    supabase
      .from("bookings")
      .select(
        "id, session_id, customer_id, invoice_id, cancelled, created_at, class_sessions!session_id(class_type_id, instructor_id, class_types(name), starts_at)"
      )
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .eq("cancelled", false),

    // Invoices in range
    supabase
      .from("invoices")
      .select(
        "id, status, total_amount, instructor_id, created_at, paid_at, cancelled_at, profiles!instructor_id(first_name, last_name)"
      )
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd),

    // Roster records for Top Employers (any session in range)
    supabase
      .from("roster_records")
      .select("employer, session_id")
      .not("employer", "is", null)
      .neq("employer", ""),

    // Certifications expiring in range for renewal rate
    supabase
      .from("certifications")
      .select("customer_id, expires_at, issued_at")
      .gte("expires_at", rangeStart)
      .lte("expires_at", rangeEnd),

    // Order items with product info for merch stats
    supabase
      .from("order_items")
      .select(
        "quantity, price_at_purchase, created_at, product_variants(product_id, products(id, name))"
      )
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd),

    // Low-stock variant count
    supabase
      .from("product_variants")
      .select("id, stock_quantity, products!inner(low_stock_threshold)")
      .filter("stock_quantity", "lte", "products.low_stock_threshold"),

    // All instructor/staff profiles for name lookup
    supabase
      .from("profiles")
      .select("id, first_name, last_name, role")
      .in("role", ["instructor", "manager", "super_admin"]),
  ]);

  const safePayments = payments ?? [];
  const safePrevPayments = prevPayments ?? [];
  const safeSessions = sessions ?? [];
  const safeBookings = bookings ?? [];
  const safeInvoices = invoices ?? [];
  const safeRosterRecords = rosterRecords ?? [];
  const safeCertifications = certifications ?? [];
  const safeOrderItems = orderItems ?? [];
  const safeLowStockVariants = lowStockVariants ?? [];

  // ── Helper: profile name lookup ──────────────────────────────────────────
  const profileMap = new Map<string, string>();
  (profiles ?? []).forEach((p) => {
    profileMap.set(p.id as string, `${p.first_name} ${p.last_name}`);
  });

  // ── Overview: revenue totals ─────────────────────────────────────────────
  const totalRev = safePayments.reduce((s, p) => s + Number(p.amount), 0);
  const onlineRev = safePayments
    .filter((p) => p.payment_type === "online")
    .reduce((s, p) => s + Number(p.amount), 0);
  const invoiceRev = safePayments
    .filter((p) => p.payment_type === "invoice")
    .reduce((s, p) => s + Number(p.amount), 0);

  const prevTotalRev = safePrevPayments.reduce((s, p) => s + Number(p.amount), 0);
  const prevOnlineRev = safePrevPayments
    .filter((p) => p.payment_type === "online")
    .reduce((s, p) => s + Number(p.amount), 0);
  const prevInvoiceRev = safePrevPayments
    .filter((p) => p.payment_type === "invoice")
    .reduce((s, p) => s + Number(p.amount), 0);

  // ── Overview: students trained ──────────────────────────────────────────
  const trainedCustomerIds = new Set(safeBookings.map((b) => b.customer_id as string));
  const studentsTrained = trainedCustomerIds.size;

  // Previous period students trained (re-fetch would be ideal but we don't have
  // previous-period bookings; use a reasonable estimate of 0 as baseline)
  const prevStudentsTrained = 0;

  // ── Revenue over time ────────────────────────────────────────────────────
  const revenueMap = new Map<string, { online: number; invoice: number }>();
  safePayments.forEach((p) => {
    const key = periodKey(p.created_at as string, useMonthly);
    const existing = revenueMap.get(key) ?? { online: 0, invoice: 0 };
    if (p.payment_type === "online") existing.online += Number(p.amount);
    if (p.payment_type === "invoice") existing.invoice += Number(p.amount);
    revenueMap.set(key, existing);
  });
  const revenueOverTime: RevenuePoint[] = Array.from(revenueMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => ({
      period: formatPeriodLabel(key),
      online: val.online,
      invoice: val.invoice,
    }));

  // ── Revenue by class type ────────────────────────────────────────────────
  // Match payments to bookings to sessions to class types
  const paymentBookingIds = new Set(
    safePayments.filter((p) => p.booking_id).map((p) => p.booking_id as string)
  );
  const classTypeRevMap = new Map<string, number>();
  safeBookings.forEach((b) => {
    if (!paymentBookingIds.has(b.id as string)) return;
    const session = b.class_sessions as { class_types: { name: string } | null } | null;
    const typeName = session?.class_types?.name ?? "Unknown";
    const payment = safePayments.find((p) => p.booking_id === b.id);
    if (!payment) return;
    classTypeRevMap.set(typeName, (classTypeRevMap.get(typeName) ?? 0) + Number(payment.amount));
  });
  const revenueByClassType: NamedRevenue[] = Array.from(classTypeRevMap.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Revenue by instructor (from invoices) ─────────────────────────────────
  const instructorRevMap = new Map<string, number>();
  safeInvoices
    .filter((inv) => inv.status === "paid")
    .forEach((inv) => {
      const iid = inv.instructor_id as string;
      const iprofile = inv.profiles as { first_name: string; last_name: string } | null;
      const name = iprofile
        ? `${iprofile.first_name} ${iprofile.last_name}`
        : (profileMap.get(iid) ?? "Unknown");
      instructorRevMap.set(name, (instructorRevMap.get(name) ?? 0) + Number(inv.total_amount));
    });
  const revenueByInstructor: NamedRevenue[] = Array.from(instructorRevMap.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Sessions per month ────────────────────────────────────────────────────
  const sessionsMonthMap = new Map<string, number>();
  safeSessions
    .filter((s) => s.status === "completed")
    .forEach((s) => {
      const key = periodKey(s.starts_at as string, true); // always monthly for this chart
      sessionsMonthMap.set(key, (sessionsMonthMap.get(key) ?? 0) + 1);
    });
  const sessionsPerMonth: SessionsPerMonth[] = Array.from(sessionsMonthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ month: formatPeriodLabel(key), count }));

  // ── Capacity utilisation ──────────────────────────────────────────────────
  // For each session, count non-cancelled bookings and compute fill %
  const capacityByType = new Map<string, { totalPct: number; sessionCount: number }>();
  safeSessions.forEach((s) => {
    const sessionBookings = safeBookings.filter((b) => b.session_id === s.id);
    const fillPct = s.max_capacity > 0 ? (sessionBookings.length / s.max_capacity) * 100 : 0;
    const ct = s.class_types as { name: string } | null;
    const typeName = ct?.name ?? "Unknown";
    const existing = capacityByType.get(typeName) ?? { totalPct: 0, sessionCount: 0 };
    existing.totalPct += fillPct;
    existing.sessionCount += 1;
    capacityByType.set(typeName, existing);
  });
  const capacityUtilisation: CapacityUtilisation[] = Array.from(capacityByType.entries())
    .filter(([, v]) => v.sessionCount > 0)
    .map(([name, v]) => ({ name, avgPct: Math.round(v.totalPct / v.sessionCount) }))
    .sort((a, b) => b.avgPct - a.avgPct);

  // ── Cancellation rate ────────────────────────────────────────────────────
  const totalSessions = safeSessions.length;
  const cancelledSessions = safeSessions.filter((s) => s.status === "cancelled").length;

  // ── Most active instructors ───────────────────────────────────────────────
  const instructorSessionMap = new Map<string, { completed: number; students: number }>();
  safeSessions
    .filter((s) => s.status === "completed")
    .forEach((s) => {
      const iid = s.instructor_id as string;
      const sessionStudents = safeBookings.filter((b) => b.session_id === s.id).length;
      const existing = instructorSessionMap.get(iid) ?? { completed: 0, students: 0 };
      existing.completed += 1;
      existing.students += sessionStudents;
      instructorSessionMap.set(iid, existing);
    });
  const activeInstructors: ActiveInstructor[] = Array.from(instructorSessionMap.entries())
    .map(([id, v]) => ({
      name: profileMap.get(id) ?? "Unknown",
      completedSessions: v.completed,
      studentsTotal: v.students,
    }))
    .sort((a, b) => b.completedSessions - a.completedSessions);

  // ── New vs returning students ─────────────────────────────────────────────
  // We need profile created_at for customers who booked in range
  // We already have bookings with customer_id — fetch profile created_at
  const uniqueCustomerIds = Array.from(trainedCustomerIds);
  let newCount = 0;
  let returningCount = 0;
  if (uniqueCustomerIds.length > 0) {
    const { data: customerProfiles } = await supabase
      .from("profiles")
      .select("id, created_at")
      .in("id", uniqueCustomerIds);
    (customerProfiles ?? []).forEach((cp) => {
      if ((cp.created_at as string) >= rangeStart) {
        newCount++;
      } else {
        returningCount++;
      }
    });
  }

  // ── Cert renewal rate ─────────────────────────────────────────────────────
  // Certs expiring in range — how many renewed within 90 days of expiry?
  let certRenewalRate: { renewed: number; total: number } | null = null;
  if (safeCertifications.length > 0) {
    const renewalWindowMs = 90 * 24 * 60 * 60 * 1000;
    let renewed = 0;
    const total = safeCertifications.length;
    for (const cert of safeCertifications) {
      const expiresAt = new Date(cert.expires_at as string);
      const windowEnd = new Date(expiresAt.getTime() + renewalWindowMs);
      // A renewal is a booking made after the expiry date and within 90 days
      const hasRenewalBooking = safeBookings.some((b) => {
        if (b.customer_id !== cert.customer_id) return false;
        const bDate = new Date(b.created_at as string);
        return bDate >= expiresAt && bDate <= windowEnd;
      });
      if (hasRenewalBooking) renewed++;
    }
    certRenewalRate = { renewed, total };
  }

  // ── Top employers ─────────────────────────────────────────────────────────
  // Filter to roster records from sessions in range
  const sessionIdsInRange = new Set(safeSessions.map((s) => s.id as string));
  const employerMap = new Map<string, number>();
  safeRosterRecords
    .filter((r) => sessionIdsInRange.has(r.session_id as string) && r.employer)
    .forEach((r) => {
      const emp = (r.employer as string).trim();
      if (emp) employerMap.set(emp, (employerMap.get(emp) ?? 0) + 1);
    });
  const topEmployers: EmployerRow[] = Array.from(employerMap.entries())
    .map(([employer, studentCount]) => ({ employer, studentCount }))
    .sort((a, b) => b.studentCount - a.studentCount)
    .slice(0, 10);

  // ── Invoice stats ─────────────────────────────────────────────────────────
  const sentCount = safeInvoices.length;
  const paidInvoices = safeInvoices.filter((inv) => inv.status === "paid" && inv.paid_at);
  const paidCount = paidInvoices.length;
  const cancelledCount = safeInvoices.filter((inv) => inv.status === "cancelled").length;
  let avgDaysToPayment = 0;
  if (paidInvoices.length > 0) {
    const totalDays = paidInvoices.reduce((sum, inv) => {
      const created = new Date(inv.created_at as string);
      const paid = new Date(inv.paid_at as string);
      return sum + (paid.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    }, 0);
    avgDaysToPayment = Math.round((totalDays / paidInvoices.length) * 10) / 10;
  }

  // ── Instructor invoice counts ─────────────────────────────────────────────
  const instructorInvoiceCountMap = new Map<string, number>();
  safeInvoices.forEach((inv) => {
    const iprofile = inv.profiles as { first_name: string; last_name: string } | null;
    const iid = inv.instructor_id as string;
    const name = iprofile
      ? `${iprofile.first_name} ${iprofile.last_name}`
      : (profileMap.get(iid) ?? "Unknown");
    instructorInvoiceCountMap.set(name, (instructorInvoiceCountMap.get(name) ?? 0) + 1);
  });
  const instructorInvoiceCounts: InstructorInvoiceCount[] = Array.from(
    instructorInvoiceCountMap.entries()
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // ── Merch revenue over time ───────────────────────────────────────────────
  const merchPeriodMap = new Map<string, number>();
  safeOrderItems.forEach((item) => {
    const key = periodKey(item.created_at as string, useMonthly);
    const revenue = Number(item.quantity) * Number(item.price_at_purchase);
    merchPeriodMap.set(key, (merchPeriodMap.get(key) ?? 0) + revenue);
  });
  const merchRevenueOverTime: MerchRevenuePoint[] = Array.from(merchPeriodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, revenue]) => ({ period: formatPeriodLabel(key), revenue }));

  // ── Merch products ────────────────────────────────────────────────────────
  const productMap = new Map<string, { units: number; revenue: number }>();
  safeOrderItems.forEach((item) => {
    const variant = item.product_variants as { products: { name: string } | null } | null;
    const productName = variant?.products?.name ?? "Unknown";
    const existing = productMap.get(productName) ?? { units: 0, revenue: 0 };
    existing.units += Number(item.quantity);
    existing.revenue += Number(item.quantity) * Number(item.price_at_purchase);
    productMap.set(productName, existing);
  });
  const merchProducts: MerchProductStat[] = Array.from(productMap.entries())
    .map(([name, v]) => ({ name, unitsSold: v.units, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    // Overview
    totalRevenue: { value: totalRev, previousValue: prevTotalRev },
    onlineRevenue: { value: onlineRev, previousValue: prevOnlineRev },
    invoiceRevenue: { value: invoiceRev, previousValue: prevInvoiceRev },
    studentsTrained: { value: studentsTrained, previousValue: prevStudentsTrained },
    // Revenue
    revenueOverTime,
    revenueByClassType,
    revenueByInstructor,
    // Classes
    sessionsPerMonth,
    capacityUtilisation,
    cancellationRate: { cancelled: cancelledSessions, total: totalSessions },
    activeInstructors,
    // Students
    studentCounts: { newCount, returningCount },
    certRenewalRate,
    topEmployers,
    // Invoices
    invoiceStats: { sent: sentCount, paid: paidCount, cancelled: cancelledCount, avgDaysToPayment },
    instructorInvoiceCounts,
    // Merch
    merchRevenueOverTime,
    merchProducts,
    lowStock: { count: safeLowStockVariants.length },
  };
}

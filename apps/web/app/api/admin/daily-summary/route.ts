/**
 * POST /api/admin/daily-summary
 * Called by:
 *   - pg_cron job (migration 0053) — daily at 11:00 UTC (7am EDT / 6am EST) (CRON_SECRET bearer)
 *   - super_admin or manager session (manual trigger)
 * Auth: super_admin/manager session OR Authorization: Bearer {CRON_SECRET}
 * Queries yesterday's activity (midnight-to-midnight in America/New_York), builds
 * an operations digest, and sends it to every active super_admin and manager.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { fetchHealthInvariants, summarizeInvariants } from "@/lib/health-invariants";
import { Resend } from "resend";
import {
  dailySummaryEmail,
  type DailySummaryRevenue,
  type DailySummaryBooking,
  type DailySummaryClassRequest,
  type DailySummaryContact,
  type DailySummaryClass,
} from "@/lib/emails";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verifies an Authorization: Bearer {CRON_SECRET} header on the request.
 * @param request - Incoming HTTP request.
 * @returns true when the bearer token matches CRON_SECRET, false otherwise.
 */
function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Returns the first element of an array or the value itself, or null if nil.
 * Supabase PostgREST joins can return a single object or a one-element array
 * depending on cardinality; this normalises both shapes.
 */
function singular<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Returns UTC ISO timestamps for midnight-to-midnight boundaries covering
 * "yesterday" and "today" in America/New_York, handling DST automatically.
 * Also returns a human-readable label for yesterday's date.
 */
function getETBoundaries(): {
  yesterdayStart: string;
  yesterdayEnd: string;
  todayStart: string;
  todayEnd: string;
  dateLabel: string;
} {
  const now = new Date();

  // en-CA locale produces reliable YYYY-MM-DD format
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  const todayET = dtf.format(now);
  // Subtract 24h to get yesterday's ET date (safe for DST: we only need the calendar date)
  const yesterdayET = dtf.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  /**
   * Converts a YYYY-MM-DD ET date string to the UTC instant for midnight on
   * that date in America/New_York. Tries EDT (-4h) then EST (-5h) and picks
   * whichever offset produces hour 0 in ET.
   */
  function etMidnightUTC(dateStr: string): Date {
    const [yr, mo, dy] = dateStr.split("-").map(Number);
    for (const offsetH of [4, 5]) {
      const candidate = new Date(Date.UTC(yr, mo - 1, dy, offsetH, 0, 0));
      const etHour = parseInt(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          hour12: false,
        })
          .formatToParts(candidate)
          .find((p) => p.type === "hour")?.value ?? "0",
        10
      );
      if (etHour === 0) return candidate;
    }
    // Fallback: assume EST (-5h) if neither offset resolves (should never happen)
    return new Date(Date.UTC(yr, mo - 1, dy, 5, 0, 0));
  }

  const yStart = etMidnightUTC(yesterdayET);
  const yEnd = etMidnightUTC(todayET);
  const tEnd = new Date(yEnd.getTime() + 24 * 60 * 60 * 1000);

  const [yy, ym, yd] = yesterdayET.split("-").map(Number);
  const dateLabel = new Date(Date.UTC(yy, ym - 1, yd)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return {
    yesterdayStart: yStart.toISOString(),
    yesterdayEnd: yEnd.toISOString(),
    todayStart: yEnd.toISOString(),
    todayEnd: tEnd.toISOString(),
    dateLabel,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * Builds and sends the daily operations summary email to all active
 * super_admin and manager profiles.
 * Side effects: reads multiple DB tables, sends one Resend email per recipient.
 * @param request - No body required; cron requests carry a CRON_SECRET bearer token.
 */
export async function POST(request: Request): Promise<Response> {

  // ── Auth check ──────────────────────────────────────────────────────────────
  const viaCron = isCronRequest(request);
  let actorId: string | null = null;

  if (!viaCron) {
    const authResult = await requireApiRole(["super_admin", "manager"]);
    if ("error" in authResult) return authResult.error;
    actorId = authResult.actor.user.id;
  }

  const admin = await createAdminClient();
  const { yesterdayStart, yesterdayEnd, todayStart, todayEnd, dateLabel } = getETBoundaries();

  // ── Parallel data fetches — independent queries run together ────────────────
  const [
    paymentsResult,
    bookingsResult,
    classRequestsResult,
    contactsResult,
    todaySessionsResult,
    newInvoicesResult,
    outstandingInvoicesResult,
    newCustomersResult,
    pendingClassApprovalsResult,
    recipientsResult,
    healthInvariants,
  ] = await Promise.all([
    // Revenue: completed payments yesterday
    admin
      .from("payments")
      .select("amount, payment_type")
      .eq("status", "completed")
      .gte("created_at", yesterdayStart)
      .lt("created_at", yesterdayEnd),

    // Bookings: non-cancelled bookings created yesterday (customer + session FK only)
    admin
      .from("bookings")
      .select("id, customer_id, session_id")
      .gte("created_at", yesterdayStart)
      .lt("created_at", yesterdayEnd)
      .eq("cancelled", false)
      .order("created_at", { ascending: true }),

    // Class requests: new requests submitted yesterday
    admin
      .from("class_requests")
      .select(`
        preferred_date, preferred_time_of_day, group_size,
        venue_city, venue_state, status,
        profiles!customer_id ( first_name, last_name ),
        class_types ( name )
      `)
      .gte("created_at", yesterdayStart)
      .lt("created_at", yesterdayEnd)
      .order("created_at", { ascending: true }),

    // Contact submissions yesterday
    admin
      .from("contact_submissions")
      .select("name, inquiry_type")
      .gte("created_at", yesterdayStart)
      .lt("created_at", yesterdayEnd)
      .order("created_at", { ascending: true }),

    // Today's sessions (non-cancelled, ordered by start time)
    admin
      .from("class_sessions")
      .select(`
        id, starts_at, max_capacity,
        class_types ( name ),
        locations ( name ),
        profiles!instructor_id ( first_name, last_name )
      `)
      .gte("starts_at", todayStart)
      .lt("starts_at", todayEnd)
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),

    // New invoices created yesterday (count only)
    admin
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .gte("created_at", yesterdayStart)
      .lt("created_at", yesterdayEnd),

    // Outstanding unpaid invoices (all time — for cash-flow awareness)
    admin
      .from("invoices")
      .select("total_amount")
      .eq("status", "sent")
      .is("paid_at", null),

    // New customer registrations yesterday (count only)
    admin
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("role", "customer")
      .gte("created_at", yesterdayStart)
      .lt("created_at", yesterdayEnd),

    // Pending class request approvals (all-time, status = 'pending')
    admin
      .from("class_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),

    // Email recipients: all active super_admin and manager profiles
    admin
      .from("profiles")
      .select("id, email, first_name")
      .in("role", ["super_admin", "manager"])
      .eq("deactivated", false),

    // Data-consistency canary (migration 0056). Never throws — a failed call
    // returns [] and is reported in the digest as "checks did not run".
    fetchHealthInvariants(admin),
  ]);

  // Log any query errors but continue — a partial digest is better than none
  if (paymentsResult.error)
    console.error("[POST /api/admin/daily-summary] payments fetch error", paymentsResult.error);
  if (bookingsResult.error)
    console.error("[POST /api/admin/daily-summary] bookings fetch error", bookingsResult.error);
  if (classRequestsResult.error)
    console.error("[POST /api/admin/daily-summary] class_requests fetch error", classRequestsResult.error);
  if (contactsResult.error)
    console.error("[POST /api/admin/daily-summary] contact_submissions fetch error", contactsResult.error);
  if (todaySessionsResult.error)
    console.error("[POST /api/admin/daily-summary] today sessions fetch error", todaySessionsResult.error);
  if (outstandingInvoicesResult.error)
    console.error("[POST /api/admin/daily-summary] outstanding invoices fetch error", outstandingInvoicesResult.error);

  // ── Bookings: resolve customer profiles + session details (two-step join) ───
  // Done in two separate queries to avoid deep nested join ambiguity in PostgREST
  // when class_sessions references profiles via multiple FK columns.
  const rawBookings = bookingsResult.data ?? [];
  const customerIds = [...new Set(rawBookings.map((b) => b.customer_id).filter(Boolean))];
  const sessionIds = [...new Set(rawBookings.map((b) => b.session_id).filter(Boolean))];

  const [customerProfilesResult, sessionDetailsResult] = await Promise.all([
    customerIds.length > 0
      ? admin
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[], error: null }),

    sessionIds.length > 0
      ? admin
          .from("class_sessions")
          .select(`
            id, starts_at,
            class_types ( name ),
            locations ( name ),
            profiles!instructor_id ( first_name, last_name )
          `)
          .in("id", sessionIds as string[])
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  type SessionRow = {
    id: string;
    starts_at: string;
    class_types: { name: string } | { name: string }[] | null;
    locations: { name: string } | { name: string }[] | null;
    profiles: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
  };

  const customerMap = new Map(
    (customerProfilesResult.data ?? []).map((p) => [p.id, p])
  );
  const sessionMap = new Map(
    ((sessionDetailsResult.data ?? []) as unknown as SessionRow[]).map((s) => [s.id, s])
  );

  const bookings: DailySummaryBooking[] = rawBookings.map((b) => {
    const customer = b.customer_id ? customerMap.get(b.customer_id) : null;
    const session = b.session_id ? sessionMap.get(b.session_id) : null;
    const classType = singular(session?.class_types ?? null);
    const location = singular(session?.locations ?? null);
    const instructor = singular(session?.profiles ?? null);

    return {
      customerName: customer
        ? `${customer.first_name} ${customer.last_name}`.trim()
        : "Unknown",
      instructorName: instructor
        ? `${instructor.first_name} ${instructor.last_name}`.trim()
        : "—",
      classType: classType?.name ?? "—",
      classDate: session?.starts_at
        ? new Date(session.starts_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/New_York",
          })
        : "—",
      location: location?.name ?? "—",
    };
  });

  // ── Class requests ───────────────────────────────────────────────────────────
  type ClassRequestRow = {
    preferred_date: string;
    preferred_time_of_day: string;
    group_size: number;
    venue_city: string;
    venue_state: string;
    status: string;
    profiles: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
    class_types: { name: string } | { name: string }[] | null;
  };

  const classRequests: DailySummaryClassRequest[] = (
    (classRequestsResult.data ?? []) as unknown as ClassRequestRow[]
  ).map((cr) => {
    const requester = singular(cr.profiles);
    const classType = singular(cr.class_types);
    const preferredDate = new Date(cr.preferred_date + "T12:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    return {
      requesterName: requester
        ? `${requester.first_name} ${requester.last_name}`.trim()
        : "Unknown",
      classType: classType?.name ?? "—",
      preferredDate,
      timeOfDay: cr.preferred_time_of_day,
      groupSize: cr.group_size,
      city: cr.venue_city,
      state: cr.venue_state,
      status: cr.status,
    };
  });

  // ── Contact submissions ───────────────────────────────────────────────────────
  const contactSubmissions: DailySummaryContact[] = (
    contactsResult.data ?? []
  ).map((c) => ({
    name: c.name ?? "Unknown",
    inquiryType: c.inquiry_type ?? "—",
  }));

  // ── Revenue ──────────────────────────────────────────────────────────────────
  const revenueMap = new Map<string, { count: number; total: number }>();
  let totalRevenue = 0;

  for (const p of paymentsResult.data ?? []) {
    const key = (p.payment_type as string) ?? "other";
    const existing = revenueMap.get(key) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += Number(p.amount ?? 0);
    revenueMap.set(key, existing);
    totalRevenue += Number(p.amount ?? 0);
  }

  const revenueBreakdown: DailySummaryRevenue[] = Array.from(revenueMap.entries()).map(
    ([type, v]) => ({ type, count: v.count, total: v.total })
  );

  // ── Today's schedule ─────────────────────────────────────────────────────────
  type TodaySessionRow = {
    id: string;
    starts_at: string;
    max_capacity: number;
    class_types: { name: string } | { name: string }[] | null;
    locations: { name: string } | { name: string }[] | null;
    profiles: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
  };

  const todayRawSessions = ((todaySessionsResult.data ?? []) as unknown as TodaySessionRow[]);
  const todaySessionIds = todayRawSessions.map((s) => s.id);

  // Fetch enrollment counts for today's sessions
  const { data: todayEnrollments } =
    todaySessionIds.length > 0
      ? await admin
          .from("bookings")
          .select("session_id")
          .in("session_id", todaySessionIds)
          .eq("cancelled", false)
      : { data: [] };

  const enrollmentMap = new Map<string, number>();
  for (const b of todayEnrollments ?? []) {
    if (b.session_id) {
      enrollmentMap.set(b.session_id, (enrollmentMap.get(b.session_id) ?? 0) + 1);
    }
  }

  const todayClasses: DailySummaryClass[] = todayRawSessions.map((s) => {
    const classType = singular(s.class_types);
    const location = singular(s.locations);
    const instructor = singular(s.profiles);

    return {
      classType: classType?.name ?? "—",
      instructorName: instructor
        ? `${instructor.first_name} ${instructor.last_name}`.trim()
        : "—",
      startsAt: new Date(s.starts_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      }),
      location: location?.name ?? "—",
      enrolled: enrollmentMap.get(s.id) ?? 0,
      maxCapacity: s.max_capacity,
    };
  });

  // ── Invoices & new customers ─────────────────────────────────────────────────
  const newInvoicesCount = newInvoicesResult.count ?? 0;
  const outstandingInvoicesData = outstandingInvoicesResult.data ?? [];
  const outstandingInvoicesCount = outstandingInvoicesData.length;
  const outstandingInvoicesTotal = outstandingInvoicesData.reduce(
    (sum, inv) => sum + Number((inv as { total_amount: string }).total_amount ?? 0),
    0
  );
  const newCustomersCount = newCustomersResult.count ?? 0;
  const pendingClassApprovalsCount = pendingClassApprovalsResult.count ?? 0;

  // ── Recipients ───────────────────────────────────────────────────────────────
  const recipients = (recipientsResult?.data ?? []).filter(
    (r): r is { id: string; email: string; first_name: string } => !!r.email
  );

  if (recipients.length === 0) {
    console.warn("[POST /api/admin/daily-summary] No active admin/manager recipients found.");
    return Response.json({ success: true, sent: 0, triggeredBy: viaCron ? "cron" : actorId });
  }

  // ── Build and send emails ────────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  const adminUrl = `${baseUrl}/admin`;

  const health = summarizeInvariants(healthInvariants);

  // Surface breaches in the server log too — the digest reaches admins, but a
  // critical breach should also be greppable without opening an inbox.
  if (health.criticalBreaches > 0) {
    console.error(
      "[POST /api/admin/daily-summary] data-consistency breaches",
      health.breached.filter((b) => b.severity === "critical")
    );
  }

  const { subject, html } = dailySummaryEmail({
    dateLabel,
    adminUrl,
    health,
    totalRevenue,
    revenueBreakdown,
    bookings,
    classRequests,
    contactSubmissions,
    todayClasses,
    newInvoicesCount,
    outstandingInvoicesCount,
    outstandingInvoicesTotal,
    newCustomersCount,
    pendingClassApprovalsCount,
  });

  let sentCount = 0;
  for (const recipient of recipients) {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: recipient.email!,
        subject,
        html,
      });
      sentCount++;
    } catch (emailError) {
      console.error(
        "[POST /api/admin/daily-summary] Email send failed for",
        recipient.email,
        emailError
      );
    }
  }

  return Response.json({
    success: true,
    sent: sentCount,
    recipients: recipients.length,
    triggeredBy: viaCron ? "cron" : actorId,
  });
}

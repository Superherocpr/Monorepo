/**
 * Server-side data assembly for the admin payout panels.
 *
 * Both /admin/payouts and Settings → Payouts render the same two panels, so the
 * queries and grouping live here once rather than being duplicated per page.
 *
 * Server-side only — uses the admin (service-role) client. Payout data is
 * compensation and recipient emails; never expose these queries to a user client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { estimatePayoutFee } from "@/lib/payout-fees";
import type {
  InstructorEarningsData,
  InstructorEarningsSummary,
  InstructorOwnEarning,
  InstructorOwnPayoutItem,
  PayoutBatchStatus,
  PayoutDenialSource,
  PayoutHistoryBatch,
  PayoutHistoryItem,
  PayoutItemStatus,
  PayoutRevenueTotals,
  UpcomingPayoutGroup,
  UpcomingPayoutSource,
  UpcomingPayoutsData,
} from "@/types/payouts";

/** Admin Supabase client shape used by dashboard reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Converts a numeric DB value to a JavaScript number, defaulting to 0. */
function money(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Converts a nullable numeric DB value to a number or null (never 0-for-null). */
function nullableMoney(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rounds a dollar amount to two decimal places using cents math. */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Logs a failed dashboard query loudly.
 *
 * These panels report money owed. A silently swallowed error renders an empty
 * "nothing is waiting" state, which reads as "no instructor is owed anything" —
 * the most misleading possible failure mode here. Nothing is thrown, because a
 * partial dashboard still beats a 500 on the whole settings page, but the failure
 * must be visible in the server logs.
 *
 * @param label - Which query failed.
 * @param error - The Supabase error, if any.
 */
function logQueryError(label: string, error: { message?: string } | null): void {
  if (!error) return;
  console.error(`[payout-dashboard] ${label} query failed:`, error.message ?? error);
}

/** Builds a display name from a profile's name parts. */
function displayName(
  profile: { first_name?: string | null; last_name?: string | null } | null,
  fallback: string
): string {
  if (!profile) return fallback;
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : fallback;
}

/** Raw earning row with its instructor profile joined. */
interface RawEarningRow {
  id: string;
  instructor_id: string;
  status: string;
  source_type: string;
  gross_amount: number | string;
  platform_fee_amount: number | string;
  instructor_amount: number | string;
  booking_id: string | null;
  invoice_id: string | null;
  payment_id: string | null;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    paypal_payout_email: string | null;
  } | null;
}

/** Session context for a booking that generated an earning. */
interface BookingContext {
  sessionId: string;
  className: string;
  startsAt: string | null;
}

/** Invoice context for an invoice that generated an earning. */
interface InvoiceContext {
  invoiceNumber: string;
  recipientName: string | null;
}

/**
 * Loads the class-session context for a set of bookings.
 * @param adminClient - Admin Supabase client.
 * @param bookingIds - Booking ids referenced by pending earnings.
 * @returns Map of booking id to its session and class type.
 */
async function loadBookingContexts(
  adminClient: AnySupabaseClient,
  bookingIds: string[]
): Promise<Map<string, BookingContext>> {
  const contexts = new Map<string, BookingContext>();
  if (bookingIds.length === 0) return contexts;

  const { data, error } = await adminClient
    .from("bookings")
    .select("id, session_id, class_sessions ( starts_at, class_types ( name ) )")
    .in("id", bookingIds);
  logQueryError("bookings context", error);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    session_id: string | null;
    class_sessions: {
      starts_at: string | null;
      class_types: { name: string | null } | null;
    } | null;
  }>;

  for (const row of rows) {
    contexts.set(row.id, {
      // Group by session so an instructor's four students in one class collapse
      // into a single "class sold" line rather than four separate rows.
      sessionId: row.session_id ?? `booking-${row.id}`,
      className: row.class_sessions?.class_types?.name ?? "Class",
      startsAt: row.class_sessions?.starts_at ?? null,
    });
  }

  return contexts;
}

/**
 * Loads invoice identifiers for a set of invoice-sourced earnings.
 * @param adminClient - Admin Supabase client.
 * @param invoiceIds - Invoice ids referenced by pending earnings.
 * @returns Map of invoice id to its number and recipient.
 */
async function loadInvoiceContexts(
  adminClient: AnySupabaseClient,
  invoiceIds: string[]
): Promise<Map<string, InvoiceContext>> {
  const contexts = new Map<string, InvoiceContext>();
  if (invoiceIds.length === 0) return contexts;

  const { data, error } = await adminClient
    .from("invoices")
    .select("id, invoice_number, recipient_name")
    .in("id", invoiceIds);
  logQueryError("invoice context", error);

  for (const row of (data ?? []) as Array<{
    id: string;
    invoice_number: string | null;
    recipient_name: string | null;
  }>) {
    contexts.set(row.id, {
      invoiceNumber: row.invoice_number ?? "Invoice",
      recipientName: row.recipient_name,
    });
  }

  return contexts;
}

/**
 * Loads measured PayPal processing fees for the payments behind these earnings.
 * @param adminClient - Admin Supabase client.
 * @param paymentIds - Payment ids referenced by pending earnings.
 * @returns Map of payment id to its recorded fee, null where untracked.
 */
async function loadPaymentFees(
  adminClient: AnySupabaseClient,
  paymentIds: string[]
): Promise<Map<string, number | null>> {
  const fees = new Map<string, number | null>();
  if (paymentIds.length === 0) return fees;

  const { data, error } = await adminClient
    .from("payments")
    .select("id, paypal_fee_amount")
    .in("id", paymentIds);
  logQueryError("payment fees", error);

  for (const row of (data ?? []) as Array<{
    id: string;
    paypal_fee_amount: number | string | null;
  }>) {
    fees.set(row.id, nullableMoney(row.paypal_fee_amount));
  }

  return fees;
}

/** Accumulator used while grouping earnings by instructor and source. */
interface GroupAccumulator {
  group: UpcomingPayoutGroup;
  sources: Map<string, UpcomingPayoutSource>;
}

/**
 * Groups earning rows into per-instructor payouts broken down by class or invoice.
 * @param rows - Earning rows to group.
 * @param bookingContexts - Session context per booking id.
 * @param invoiceContexts - Invoice context per invoice id.
 * @returns Instructor groups sorted by name, each with sorted source lines.
 */
function groupEarnings(
  rows: RawEarningRow[],
  bookingContexts: Map<string, BookingContext>,
  invoiceContexts: Map<string, InvoiceContext>
): UpcomingPayoutGroup[] {
  const accumulators = new Map<string, GroupAccumulator>();

  for (const row of rows) {
    const gross = money(row.gross_amount);
    const platformFee = money(row.platform_fee_amount);
    const instructorAmount = money(row.instructor_amount);

    let accumulator = accumulators.get(row.instructor_id);
    if (!accumulator) {
      accumulator = {
        group: {
          instructorId: row.instructor_id,
          instructorName: displayName(row.profiles, "Instructor"),
          instructorEmail: row.profiles?.email ?? "",
          paypalPayoutEmail: row.profiles?.paypal_payout_email ?? null,
          grossAmount: 0,
          platformFeeAmount: 0,
          instructorAmount: 0,
          earningCount: 0,
          estimatedPayoutFee: 0,
          sources: [],
        },
        sources: new Map(),
      };
      accumulators.set(row.instructor_id, accumulator);
    }

    accumulator.group.grossAmount += gross;
    accumulator.group.platformFeeAmount += platformFee;
    accumulator.group.instructorAmount += instructorAmount;
    accumulator.group.earningCount += 1;

    // Resolve which line this earning rolls up into.
    let key: string;
    let source: Omit<UpcomingPayoutSource, "grossAmount" | "platformFeeAmount" | "instructorAmount" | "soldCount">;

    if (row.booking_id) {
      const context = bookingContexts.get(row.booking_id);
      key = context?.sessionId ?? `booking-${row.booking_id}`;
      source = {
        key,
        kind: "session",
        label: context?.className ?? "Class",
        detail: null,
        sessionDate: context?.startsAt ?? null,
      };
    } else if (row.invoice_id) {
      const context = invoiceContexts.get(row.invoice_id);
      key = `invoice-${row.invoice_id}`;
      source = {
        key,
        kind: "invoice",
        label: context?.invoiceNumber ? `Invoice ${context.invoiceNumber}` : "Invoice",
        detail: context?.recipientName ?? null,
        sessionDate: null,
      };
    } else {
      key = `earning-${row.id}`;
      source = { key, kind: "invoice", label: "Adjustment", detail: null, sessionDate: null };
    }

    const existing = accumulator.sources.get(key);
    if (existing) {
      existing.grossAmount += gross;
      existing.platformFeeAmount += platformFee;
      existing.instructorAmount += instructorAmount;
      existing.soldCount += 1;
    } else {
      accumulator.sources.set(key, {
        ...source,
        soldCount: 1,
        grossAmount: gross,
        platformFeeAmount: platformFee,
        instructorAmount: instructorAmount,
      });
    }
  }

  return Array.from(accumulators.values())
    .map(({ group, sources }) => ({
      ...group,
      grossAmount: roundCurrency(group.grossAmount),
      platformFeeAmount: roundCurrency(group.platformFeeAmount),
      instructorAmount: roundCurrency(group.instructorAmount),
      // One payout item per instructor, so the fee is estimated on the combined
      // amount — that is what makes batching cheaper than paying per booking.
      estimatedPayoutFee: estimatePayoutFee(roundCurrency(group.instructorAmount)),
      sources: Array.from(sources.values())
        .map((source) => ({
          ...source,
          grossAmount: roundCurrency(source.grossAmount),
          platformFeeAmount: roundCurrency(source.platformFeeAmount),
          instructorAmount: roundCurrency(source.instructorAmount),
        }))
        .sort((left, right) => {
          // Newest class first; invoices (no date) after classes.
          if (left.sessionDate && right.sessionDate) {
            return right.sessionDate.localeCompare(left.sessionDate);
          }
          if (left.sessionDate) return -1;
          if (right.sessionDate) return 1;
          return left.label.localeCompare(right.label);
        }),
    }))
    .sort((left, right) => right.instructorAmount - left.instructorAmount);
}

/**
 * Sums revenue, measured inbound fees, and estimated outbound fees for a bucket.
 * @param rows - Earning rows in the bucket.
 * @param groups - Grouped instructor payouts for the same rows.
 * @param paymentFees - Measured PayPal fee per payment id.
 * @returns Totals with measured and estimated figures kept distinct.
 */
function sumTotals(
  rows: RawEarningRow[],
  groups: UpcomingPayoutGroup[],
  paymentFees: Map<string, number | null>
): PayoutRevenueTotals {
  let grossCollected = 0;
  let platformCut = 0;
  let instructorTotal = 0;
  let inboundPayPalFees = 0;
  let feeTrackedCount = 0;
  let feeUntrackedCount = 0;

  for (const row of rows) {
    grossCollected += money(row.gross_amount);
    platformCut += money(row.platform_fee_amount);
    instructorTotal += money(row.instructor_amount);

    const fee = row.payment_id ? paymentFees.get(row.payment_id) ?? null : null;
    if (fee === null) {
      // Invoices and offline payments never report a fee. Counted separately so
      // the UI can say the net figure is partial rather than implying zero cost.
      feeUntrackedCount += 1;
    } else {
      inboundPayPalFees += fee;
      feeTrackedCount += 1;
    }
  }

  const estimatedPayoutFees = groups.reduce(
    (sum, group) => sum + group.estimatedPayoutFee,
    0
  );

  return {
    grossCollected: roundCurrency(grossCollected),
    platformCut: roundCurrency(platformCut),
    instructorTotal: roundCurrency(instructorTotal),
    inboundPayPalFees: roundCurrency(inboundPayPalFees),
    feeTrackedCount,
    feeUntrackedCount,
    estimatedPayoutFees: roundCurrency(estimatedPayoutFees),
    estimatedNet: roundCurrency(platformCut - inboundPayPalFees - estimatedPayoutFees),
    earningCount: rows.length,
  };
}

/**
 * Builds the upcoming-payouts view: who is owed what, from which classes, and
 * what the platform actually keeps.
 *
 * Splits into three buckets because each needs different action:
 *   - payableNow — ready to send
 *   - blocked    — instructor has saved no payout email
 *   - inFlight   — already sent to PayPal, awaiting confirmation. Previously
 *                  invisible, which made money appear to vanish after sending.
 *
 * @param adminClient - Admin Supabase client.
 * @returns Grouped upcoming payouts with revenue and fee totals.
 */
export async function getUpcomingPayoutsData(
  adminClient: AnySupabaseClient
): Promise<UpcomingPayoutsData> {
  const { data: earningRows, error: earningsError } = await adminClient
    .from("instructor_earnings")
    .select(
      `
      id,
      instructor_id,
      status,
      source_type,
      gross_amount,
      platform_fee_amount,
      instructor_amount,
      booking_id,
      invoice_id,
      payment_id,
      profiles!instructor_id (
        first_name,
        last_name,
        email,
        paypal_payout_email
      )
      `
    )
    .in("status", ["pending", "payout_pending"])
    .order("created_at", { ascending: true });
  logQueryError("upcoming earnings", earningsError);

  const rows = (earningRows ?? []) as unknown as RawEarningRow[];

  const [bookingContexts, invoiceContexts, paymentFees] = await Promise.all([
    loadBookingContexts(
      adminClient,
      rows.map((row) => row.booking_id).filter((id): id is string => Boolean(id))
    ),
    loadInvoiceContexts(
      adminClient,
      rows.map((row) => row.invoice_id).filter((id): id is string => Boolean(id))
    ),
    loadPaymentFees(
      adminClient,
      rows.map((row) => row.payment_id).filter((id): id is string => Boolean(id))
    ),
  ]);

  const pendingRows = rows.filter((row) => row.status === "pending");
  const inFlightRows = rows.filter((row) => row.status === "payout_pending");

  const hasPayoutEmail = (row: RawEarningRow): boolean =>
    Boolean(row.profiles?.paypal_payout_email?.trim());

  const payableRows = pendingRows.filter(hasPayoutEmail);
  const blockedRows = pendingRows.filter((row) => !hasPayoutEmail(row));

  const payableNow = groupEarnings(payableRows, bookingContexts, invoiceContexts);
  const blocked = groupEarnings(blockedRows, bookingContexts, invoiceContexts);
  const inFlight = groupEarnings(inFlightRows, bookingContexts, invoiceContexts);

  return {
    payableNow,
    blocked,
    inFlight,
    payableTotals: sumTotals(payableRows, payableNow, paymentFees),
    blockedTotal: roundCurrency(
      blocked.reduce((sum, group) => sum + group.instructorAmount, 0)
    ),
    inFlightTotal: roundCurrency(
      inFlight.reduce((sum, group) => sum + group.instructorAmount, 0)
    ),
  };
}

/** Raw batch row loaded for the history panel. */
interface RawBatchRow {
  id: string;
  status: string;
  sender_batch_id: string;
  paypal_payout_batch_id: string | null;
  total_amount: number | string;
  item_count: number;
  paypal_fee_total: number | string | null;
  error_message: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  denied_at: string | null;
  denial_source: string | null;
  denial_reason: string | null;
  retry_of_batch_id: string | null;
  profiles: { first_name: string | null; last_name: string | null } | null;
}

/**
 * Computes how many resends deep a batch is by walking its retry chain.
 * @param batchId - Batch to measure.
 * @param parentByBatchId - Map of batch id to the batch it retries.
 * @returns Retry depth, 0 for an original batch.
 */
function computeRetryDepth(
  batchId: string,
  parentByBatchId: Map<string, string | null>
): number {
  let depth = 0;
  let current = parentByBatchId.get(batchId) ?? null;
  const seen = new Set<string>([batchId]);

  while (current && !seen.has(current)) {
    depth += 1;
    seen.add(current);
    current = parentByBatchId.get(current) ?? null;
    // Guard against a pathological chain; depth beyond this is not worth showing.
    if (depth > 20) break;
  }

  return depth;
}

/**
 * Loads recent payout batches with their per-instructor items and retry lineage.
 *
 * Every batch keeps its own row permanently, including denied ones, so the
 * history shows what was attempted and what happened rather than only the
 * successful end state.
 *
 * @param adminClient - Admin Supabase client.
 * @param limit - How many batches to return, newest first.
 * @returns Batches with items attached, newest first.
 */
export async function getPayoutHistory(
  adminClient: AnySupabaseClient,
  limit = 25
): Promise<PayoutHistoryBatch[]> {
  const { data: batchRows, error: batchError } = await adminClient
    .from("instructor_payout_batches")
    .select(
      `
      id,
      status,
      sender_batch_id,
      paypal_payout_batch_id,
      total_amount,
      item_count,
      paypal_fee_total,
      error_message,
      created_at,
      submitted_at,
      completed_at,
      denied_at,
      denial_source,
      denial_reason,
      retry_of_batch_id,
      profiles!denied_by ( first_name, last_name )
      `
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  logQueryError("payout history batches", batchError);

  const batches = (batchRows ?? []) as unknown as RawBatchRow[];
  if (batches.length === 0) return [];

  const batchIds = batches.map((batch) => batch.id);

  // Retry parents can fall outside the page window, so resolve any that are
  // missing rather than showing a retry with no visible origin.
  const parentIds = batches
    .map((batch) => batch.retry_of_batch_id)
    .filter((id): id is string => Boolean(id) && !batchIds.includes(id as string));

  const senderBatchIdById = new Map<string, string>(
    batches.map((batch) => [batch.id, batch.sender_batch_id])
  );
  const parentByBatchId = new Map<string, string | null>(
    batches.map((batch) => [batch.id, batch.retry_of_batch_id])
  );

  if (parentIds.length > 0) {
    const { data: parentRows, error: parentError } = await adminClient
      .from("instructor_payout_batches")
      .select("id, sender_batch_id, retry_of_batch_id")
      .in("id", parentIds);
    logQueryError("retry parent batches", parentError);

    for (const row of (parentRows ?? []) as Array<{
      id: string;
      sender_batch_id: string;
      retry_of_batch_id: string | null;
    }>) {
      senderBatchIdById.set(row.id, row.sender_batch_id);
      parentByBatchId.set(row.id, row.retry_of_batch_id);
    }
  }

  const { data: itemRows, error: itemsError } = await adminClient
    .from("instructor_payout_items")
    .select(
      `
      id,
      payout_batch_id,
      instructor_id,
      recipient_email,
      amount,
      status,
      paypal_fee_amount,
      error_message,
      unclaimed_expires_at,
      denied_at,
      denial_source,
      denial_reason,
      profiles!instructor_id ( first_name, last_name )
      `
    )
    .in("payout_batch_id", batchIds)
    .order("amount", { ascending: false });
  logQueryError("payout history items", itemsError);

  const items = (itemRows ?? []) as unknown as Array<{
    id: string;
    payout_batch_id: string;
    instructor_id: string;
    recipient_email: string;
    amount: number | string;
    status: string;
    paypal_fee_amount: number | string | null;
    error_message: string | null;
    unclaimed_expires_at: string | null;
    denied_at: string | null;
    denial_source: string | null;
    denial_reason: string | null;
    profiles: { first_name: string | null; last_name: string | null } | null;
  }>;

  const itemsByBatch = new Map<string, PayoutHistoryItem[]>();
  for (const item of items) {
    const mapped: PayoutHistoryItem = {
      id: item.id,
      instructorId: item.instructor_id,
      instructorName: displayName(item.profiles, "Instructor"),
      recipientEmail: item.recipient_email,
      amount: money(item.amount),
      status: item.status as PayoutItemStatus,
      paypalFeeAmount: nullableMoney(item.paypal_fee_amount),
      errorMessage: item.error_message,
      unclaimedExpiresAt: item.unclaimed_expires_at,
      deniedAt: item.denied_at,
      denialSource: (item.denial_source as PayoutDenialSource | null) ?? null,
      denialReason: item.denial_reason,
    };
    const list = itemsByBatch.get(item.payout_batch_id);
    if (list) list.push(mapped);
    else itemsByBatch.set(item.payout_batch_id, [mapped]);
  }

  return batches.map((batch) => ({
    id: batch.id,
    status: batch.status as PayoutBatchStatus,
    senderBatchId: batch.sender_batch_id,
    paypalPayoutBatchId: batch.paypal_payout_batch_id,
    totalAmount: money(batch.total_amount),
    itemCount: batch.item_count,
    paypalFeeTotal: nullableMoney(batch.paypal_fee_total),
    errorMessage: batch.error_message,
    createdAt: batch.created_at,
    submittedAt: batch.submitted_at,
    completedAt: batch.completed_at,
    deniedAt: batch.denied_at,
    denialSource: (batch.denial_source as PayoutDenialSource | null) ?? null,
    denialReason: batch.denial_reason,
    deniedByName: batch.profiles ? displayName(batch.profiles, "Super admin") : null,
    retryOfBatchId: batch.retry_of_batch_id,
    retryOfSenderBatchId: batch.retry_of_batch_id
      ? senderBatchIdById.get(batch.retry_of_batch_id) ?? null
      : null,
    retryDepth: computeRetryDepth(batch.id, parentByBatchId),
    items: itemsByBatch.get(batch.id) ?? [],
  }));
}

/**
 * Derives lifetime summary totals from a set of an instructor's own earning rows.
 * Pure — no DB access. Exported for unit testing.
 *
 * Status buckets:
 *   pending       → waiting to be included in a payout batch
 *   payout_pending → reserved in a batch sent to PayPal, not yet confirmed
 *   paid          → confirmed delivered
 *
 * @param earnings - Earning rows already mapped to InstructorOwnEarning.
 * @returns Rounded totals per status bucket plus an all-time total.
 */
export function buildInstructorEarningsSummary(
  earnings: Pick<InstructorOwnEarning, "status" | "instructorAmount">[]
): InstructorEarningsSummary {
  let totalEarned = 0;
  let pendingAmount = 0;
  let inFlightAmount = 0;
  let paidAmount = 0;

  for (const e of earnings) {
    totalEarned += e.instructorAmount;
    if (e.status === "pending") pendingAmount += e.instructorAmount;
    else if (e.status === "payout_pending") inFlightAmount += e.instructorAmount;
    else if (e.status === "paid") paidAmount += e.instructorAmount;
  }

  return {
    totalEarned: roundCurrency(totalEarned),
    pendingAmount: roundCurrency(pendingAmount),
    inFlightAmount: roundCurrency(inFlightAmount),
    paidAmount: roundCurrency(paidAmount),
    earningCount: earnings.length,
  };
}

/**
 * Loads an instructor's own earnings and payout history for the profile payment page.
 * Returns individual earning rows with class/invoice context, lifetime summary totals,
 * and the payout batch items they were included in.
 *
 * @param adminClient - Admin Supabase client (service role).
 * @param instructorId - Profile id of the instructor whose data to load.
 * @returns Earnings summary, individual rows, and payout history, all scoped to this instructor.
 */
export async function getInstructorEarningsData(
  adminClient: AnySupabaseClient,
  instructorId: string
): Promise<InstructorEarningsData> {
  const { data: earningRows, error: earningsError } = await adminClient
    .from("instructor_earnings")
    .select(
      "id, status, source_type, gross_amount, platform_fee_amount, instructor_amount, booking_id, invoice_id, created_at"
    )
    .eq("instructor_id", instructorId)
    .order("created_at", { ascending: false })
    .limit(200);
  logQueryError("instructor own earnings", earningsError);

  const rows = (earningRows ?? []) as unknown as Array<{
    id: string;
    status: string;
    source_type: string;
    gross_amount: number | string;
    platform_fee_amount: number | string;
    instructor_amount: number | string;
    booking_id: string | null;
    invoice_id: string | null;
    created_at: string;
  }>;

  const bookingIds = rows.map((r) => r.booking_id).filter((id): id is string => Boolean(id));
  const invoiceIds = rows.map((r) => r.invoice_id).filter((id): id is string => Boolean(id));

  const [bookingContexts, invoiceContexts] = await Promise.all([
    loadBookingContexts(adminClient, bookingIds),
    loadInvoiceContexts(adminClient, invoiceIds),
  ]);

  const earnings: InstructorOwnEarning[] = rows.map((row) => {
    let label = "Adjustment";
    let detail: string | null = null;
    let sessionDate: string | null = null;

    if (row.booking_id) {
      const ctx = bookingContexts.get(row.booking_id);
      label = ctx?.className ?? "Class";
      sessionDate = ctx?.startsAt ?? null;
    } else if (row.invoice_id) {
      const ctx = invoiceContexts.get(row.invoice_id);
      label = ctx ? `Invoice ${ctx.invoiceNumber}` : "Invoice";
      detail = ctx?.recipientName ?? null;
    }

    return {
      id: row.id,
      status: row.status,
      sourceType: row.source_type as "booking" | "invoice",
      grossAmount: money(row.gross_amount),
      platformFeeAmount: money(row.platform_fee_amount),
      instructorAmount: money(row.instructor_amount),
      createdAt: row.created_at,
      label,
      detail,
      sessionDate,
    };
  });

  const summary = buildInstructorEarningsSummary(earnings);

  // Fetch payout items this instructor was included in, with their batch metadata.
  const { data: itemRows, error: itemsError } = await adminClient
    .from("instructor_payout_items")
    .select(
      `
      id, amount, status, paypal_fee_amount, error_message,
      unclaimed_expires_at, denied_at, denial_reason,
      instructor_payout_batches!payout_batch_id (
        sender_batch_id, paypal_payout_batch_id, status,
        created_at, submitted_at, completed_at
      )
      `
    )
    .eq("instructor_id", instructorId)
    .order("created_at", { ascending: false })
    .limit(50);
  logQueryError("instructor own payout items", itemsError);

  type RawPayoutItemRow = {
    id: string;
    amount: number | string;
    status: string;
    paypal_fee_amount: number | string | null;
    error_message: string | null;
    unclaimed_expires_at: string | null;
    denied_at: string | null;
    denial_reason: string | null;
    instructor_payout_batches: {
      sender_batch_id: string;
      paypal_payout_batch_id: string | null;
      status: string;
      created_at: string;
      submitted_at: string | null;
      completed_at: string | null;
    } | null;
  };

  const payoutItems: InstructorOwnPayoutItem[] = (
    (itemRows ?? []) as unknown as RawPayoutItemRow[]
  ).map((item) => ({
    id: item.id,
    amount: money(item.amount),
    status: item.status as PayoutItemStatus,
    paypalFeeAmount: nullableMoney(item.paypal_fee_amount),
    errorMessage: item.error_message,
    unclaimedExpiresAt: item.unclaimed_expires_at,
    deniedAt: item.denied_at,
    denialReason: item.denial_reason,
    batchSenderBatchId: item.instructor_payout_batches?.sender_batch_id ?? "",
    paypalPayoutBatchId: item.instructor_payout_batches?.paypal_payout_batch_id ?? null,
    batchStatus: (item.instructor_payout_batches?.status ?? "pending") as PayoutBatchStatus,
    batchCreatedAt: item.instructor_payout_batches?.created_at ?? "",
    batchSubmittedAt: item.instructor_payout_batches?.submitted_at ?? null,
    batchCompletedAt: item.instructor_payout_batches?.completed_at ?? null,
  }));

  return { summary, earnings, payoutItems };
}

/**
 * Instructor earnings helpers.
 * Converts paid bookings and invoices into payout-ready accounting rows.
 * Used by booking confirmation and invoice mark-paid API routes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Source values stored in instructor_earnings.source_type. */
export type InstructorEarningSourceType = "booking" | "invoice";

/** Result of applying the platform fee to a gross payment amount. */
export interface InstructorEarningAmounts {
  /** Full amount collected from the student or invoice recipient. */
  grossAmount: number;
  /** SuperHeroCPR platform cut percentage used for the calculation. */
  platformFeePercent: number;
  /** Dollar amount retained by SuperHeroCPR. */
  platformFeeAmount: number;
  /** Dollar amount owed to the instructor. */
  instructorAmount: number;
}

/** Parameters required to record an online booking earning. */
interface BookingEarningParams {
  instructorId: string;
  /**
   * The booking this earning is tied to, or null when there is no booking row
   * to attach it to (e.g. a manual register charge for a session where the
   * admin never clicked "Add Student"). The earning is still recorded against
   * the session's instructor either way — it's payment for the class whether
   * or not a booking exists.
   */
  bookingId: string | null;
  paymentId: string | null;
  grossAmount: number;
  note?: string;
}

/** Parameters required to record a paid invoice earning. */
interface InvoiceEarningParams {
  instructorId: string;
  invoiceId: string;
  grossAmount: number;
  note?: string;
}

/** Rounds a dollar amount to two decimal places using cents math. */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Converts a setting or environment value to a safe percentage.
 * Falls back to 20% when missing or invalid.
 * @param rawValue - String value read from system_settings or env.
 * @returns A clamped platform fee percentage between 0 and 100.
 */
function normalizeFeePercent(rawValue: string | null | undefined): number {
  const parsed = rawValue == null ? NaN : Number(rawValue);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(100, Math.max(0, parsed));
}

/**
 * Reads the platform fee percentage used to calculate instructor payouts.
 * system_settings.platform_fee_percent wins; PLATFORM_FEE_PERCENT is the env fallback.
 * @param supabase - Supabase client with access to system_settings.
 * @returns Platform fee percentage to retain for SuperHeroCPR.
 */
export async function getPlatformFeePercent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>
): Promise<number> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "platform_fee_percent")
    .maybeSingle();

  return normalizeFeePercent(
    (data as { value?: string } | null)?.value ?? process.env.PLATFORM_FEE_PERCENT
  );
}

/**
 * Calculates the platform fee and instructor amount from a gross payment.
 * @param grossAmount - Full collected amount in dollars.
 * @param platformFeePercent - Percentage retained by SuperHeroCPR.
 * @returns Rounded gross, fee, and instructor amounts.
 */
export function calculateInstructorEarning(
  grossAmount: number,
  platformFeePercent: number
): InstructorEarningAmounts {
  const safeGross = roundCurrency(Math.max(0, grossAmount));
  const safePercent = Math.min(100, Math.max(0, platformFeePercent));
  const platformFeeAmount = roundCurrency(safeGross * (safePercent / 100));
  const instructorAmount = roundCurrency(safeGross - platformFeeAmount);

  return {
    grossAmount: safeGross,
    platformFeePercent: safePercent,
    platformFeeAmount,
    instructorAmount,
  };
}

/**
 * Inserts an instructor earning row, ignoring duplicate source rows safely.
 * Side effects: INSERT into instructor_earnings.
 * @param supabase - Admin Supabase client.
 * @param sourceType - Whether the earning came from a booking or invoice.
 * @param sourceIds - Source identifiers used by the uniqueness constraints.
 * @param amounts - Calculated earning amounts.
 * @param instructorId - Instructor who should receive the payout.
 * @param note - Optional internal note for reconciliation.
 */
async function insertInstructorEarning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  sourceType: InstructorEarningSourceType,
  sourceIds: { bookingId?: string; invoiceId?: string; paymentId?: string | null },
  amounts: InstructorEarningAmounts,
  instructorId: string,
  note: string | null
): Promise<void> {
  const { error } = await supabase.from("instructor_earnings").insert({
    instructor_id: instructorId,
    source_type: sourceType,
    booking_id: sourceIds.bookingId ?? null,
    invoice_id: sourceIds.invoiceId ?? null,
    payment_id: sourceIds.paymentId ?? null,
    gross_amount: amounts.grossAmount,
    platform_fee_percent: amounts.platformFeePercent,
    platform_fee_amount: amounts.platformFeeAmount,
    instructor_amount: amounts.instructorAmount,
    status: amounts.instructorAmount > 0 ? "pending" : "paid",
    notes: note,
  });

  if (error?.code === "23505") return;
  if (error) {
    throw new Error(`Instructor earning insert failed: ${error.message}`);
  }
}

/**
 * Records the instructor earning for a completed online booking payment.
 * Side effects: reads platform fee setting and inserts instructor_earnings.
 * @param supabase - Admin Supabase client.
 * @param params - Booking earning identifiers and gross amount.
 */
export async function recordBookingEarning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  params: BookingEarningParams
): Promise<void> {
  const platformFeePercent = await getPlatformFeePercent(supabase);
  const amounts = calculateInstructorEarning(params.grossAmount, platformFeePercent);
  await insertInstructorEarning(
    supabase,
    "booking",
    {
      bookingId: params.bookingId ?? undefined,
      paymentId: params.paymentId,
    },
    amounts,
    params.instructorId,
    params.note ?? "Online booking payment"
  );
}

/**
 * Records the instructor earning for a newly paid invoice.
 * Side effects: reads platform fee setting and inserts instructor_earnings.
 * @param supabase - Admin Supabase client.
 * @param params - Invoice earning identifiers and gross amount.
 */
export async function recordInvoiceEarning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  params: InvoiceEarningParams
): Promise<void> {
  const platformFeePercent = await getPlatformFeePercent(supabase);
  const amounts = calculateInstructorEarning(params.grossAmount, platformFeePercent);
  await insertInstructorEarning(
    supabase,
    "invoice",
    { invoiceId: params.invoiceId },
    amounts,
    params.instructorId,
    params.note ?? "Paid invoice"
  );
}

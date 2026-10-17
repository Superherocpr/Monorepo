/**
 * Records how an invoice was paid and what PayPal charged to collect it.
 *
 * Only a PayPal payment costs a collection fee. Check, cash, bank transfer and
 * other methods record a KNOWN zero, which is different from "not tracked" (NULL):
 * the payout dashboard treats a known zero as a measured figure and keeps its
 * "no fee recorded" warning for the genuinely unknown ones.
 *
 * A PayPal payment starts with an unknown fee, because PayPal's Transaction
 * Search can lag payment by up to three hours. `recordInvoicePayment` makes one
 * attempt straight away and `syncInvoicePayPalFees` (run hourly) finishes the job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoicePaymentMethod } from "@/types/invoices";
import { lookupInvoicePayPalFee } from "@/lib/paypal-invoice-fees";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Every payment method an invoice can be recorded as paid with. */
export const INVOICE_PAYMENT_METHODS: readonly InvoicePaymentMethod[] = [
  "paypal",
  "check",
  "cash",
  "bank_transfer",
  "other",
];

/** How far back the hourly sync keeps looking for a missing fee, in days. */
const FEE_SYNC_LOOKBACK_DAYS = 30;

/** Most invoices the hourly sync examines per run, so one run stays bounded. */
const FEE_SYNC_BATCH_SIZE = 25;

/**
 * Type guard for a payment method value arriving from a request body.
 * @param value - Untrusted value.
 * @returns True when it is one of the five known methods.
 */
export function isInvoicePaymentMethod(value: unknown): value is InvoicePaymentMethod {
  return (
    typeof value === "string" &&
    (INVOICE_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

/** The fee and net amount to store on an invoice. Both are null while unknown. */
export interface InvoiceFeeAmounts {
  paypalFeeAmount: number | null;
  netAmount: number | null;
}

/** Rounds a dollar amount to cents. */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Works out the fee and net amount to store for a paid invoice.
 *
 * Non-PayPal methods are a known $0 fee. A PayPal payment with no fee yet, or a
 * fee larger than the invoice (which would mean a bad lookup), stays unknown so
 * the dashboard flags it rather than showing an impossible net.
 *
 * @param method - How the invoice was paid.
 * @param totalAmount - Invoice total in dollars.
 * @param paypalFee - Fee read from PayPal, or null when not known yet.
 * @returns Fee and net amount, both null when unknown.
 */
export function resolveInvoiceFees(
  method: InvoicePaymentMethod,
  totalAmount: number,
  paypalFee: number | null
): InvoiceFeeAmounts {
  if (method !== "paypal") {
    return { paypalFeeAmount: 0, netAmount: roundCurrency(totalAmount) };
  }
  if (paypalFee === null || paypalFee < 0 || paypalFee > totalAmount) {
    return { paypalFeeAmount: null, netAmount: null };
  }
  const fee = roundCurrency(paypalFee);
  return { paypalFeeAmount: fee, netAmount: roundCurrency(totalAmount - fee) };
}

/** What the invoice needs to be recorded against. */
export interface RecordInvoicePaymentParams {
  invoiceId: string;
  method: InvoicePaymentMethod;
  totalAmount: number;
  /** PayPal's invoice id; null for invoices that never went through PayPal. */
  platformInvoiceId: string | null;
  /** When the invoice was marked paid. */
  paidAt: Date;
}

/**
 * Stores the payment method and fee on a just-paid invoice.
 *
 * Side effects: UPDATE invoices; for a PayPal payment, up to two PayPal reads
 * (see lookupInvoicePayPalFee). Never throws: a failure here must not undo a
 * payment that has already been recorded, and a missing fee is picked up by the
 * hourly sync, so errors are logged and swallowed.
 *
 * @param adminClient - Admin Supabase client.
 * @param params - Invoice, method, total, and paid time.
 */
export async function recordInvoicePayment(
  adminClient: AnySupabaseClient,
  params: RecordInvoicePaymentParams
): Promise<void> {
  try {
    let paypalFee: number | null = null;
    if (params.method === "paypal" && params.platformInvoiceId) {
      const lookup = await lookupInvoicePayPalFee(params.platformInvoiceId, params.paidAt);
      if (lookup.status === "found") paypalFee = lookup.fee;
    }

    const amounts = resolveInvoiceFees(params.method, params.totalAmount, paypalFee);
    const { error } = await adminClient
      .from("invoices")
      .update({
        payment_method: params.method,
        paypal_fee_amount: amounts.paypalFeeAmount,
        net_amount: amounts.netAmount,
      })
      .eq("id", params.invoiceId);

    if (error) {
      console.error("[invoice-fees] Failed to record invoice payment method:", error.message);
    }
  } catch (err) {
    console.error("[invoice-fees] recordInvoicePayment failed:", err);
  }
}

/** Counts from one fee sync run. */
export interface InvoiceFeeSyncResult {
  /** Paid PayPal invoices still missing a fee that were examined. */
  checked: number;
  /** Fees found and stored. */
  updated: number;
  /** PayPal had not reported the fee yet; retried next run. */
  pending: number;
  /** Lookups that failed outright (for example Transaction Search not enabled). */
  unavailable: number;
  /** The reason from the first failed lookup, for the cron log. */
  firstUnavailableReason: string | null;
}

/**
 * Fills in the PayPal fee on paid PayPal invoices that do not have one yet.
 *
 * Side effects: PayPal reads and UPDATE invoices. Safe to run repeatedly: only
 * invoices with a NULL fee are touched, and the update is guarded on that so a
 * fee recorded in the meantime is never overwritten.
 *
 * @param adminClient - Admin Supabase client.
 * @returns Counts of what was examined, filled, still waiting, and failed.
 */
export async function syncInvoicePayPalFees(
  adminClient: AnySupabaseClient
): Promise<InvoiceFeeSyncResult> {
  const result: InvoiceFeeSyncResult = {
    checked: 0,
    updated: 0,
    pending: 0,
    unavailable: 0,
    firstUnavailableReason: null,
  };

  const since = new Date(Date.now() - FEE_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await adminClient
    .from("invoices")
    .select("id, total_amount, platform_invoice_id, paid_at")
    .eq("status", "paid")
    .eq("payment_method", "paypal")
    .is("paypal_fee_amount", null)
    .not("platform_invoice_id", "is", null)
    .gte("paid_at", since.toISOString())
    .order("paid_at", { ascending: true })
    .limit(FEE_SYNC_BATCH_SIZE);

  if (error) {
    console.error("[invoice-fees] Fee sync lookup failed:", error.message);
    return result;
  }

  for (const row of (data ?? []) as Array<{
    id: string;
    total_amount: number | string;
    platform_invoice_id: string;
    paid_at: string;
  }>) {
    result.checked += 1;
    const total = Number(row.total_amount);
    const lookup = await lookupInvoicePayPalFee(row.platform_invoice_id, new Date(row.paid_at));

    if (lookup.status === "pending") {
      result.pending += 1;
      continue;
    }
    if (lookup.status === "unavailable") {
      result.unavailable += 1;
      result.firstUnavailableReason ??= lookup.reason;
      continue;
    }

    const amounts = resolveInvoiceFees("paypal", total, lookup.fee);
    if (amounts.paypalFeeAmount === null) {
      // A fee larger than the invoice is a bad lookup, not a real charge.
      result.pending += 1;
      continue;
    }

    const { error: updateError } = await adminClient
      .from("invoices")
      .update({
        paypal_fee_amount: amounts.paypalFeeAmount,
        net_amount: amounts.netAmount,
      })
      .eq("id", row.id)
      .is("paypal_fee_amount", null);

    if (updateError) {
      console.error("[invoice-fees] Fee update failed:", updateError.message);
    } else {
      result.updated += 1;
    }
  }

  return result;
}

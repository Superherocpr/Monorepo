/**
 * Reads the PayPal collection fee for a PayPal invoice that has been paid.
 *
 * PayPal's invoice response says HOW an invoice was paid but carries no fee. The
 * fee lives on the underlying transaction, which only the Transaction Search API
 * reports (`transaction_info.fee_amount`, negative because it is a deduction).
 * Two limits shape the callers:
 *   - A paid transaction can take up to three hours to appear in Transaction
 *     Search, so a lookup straight after payment often finds nothing. That is
 *     "not yet", not "no fee": the caller retries on the hourly sync.
 *   - Transaction Search must be enabled on the PayPal REST app. When it is not,
 *     PayPal answers 403; this is reported as `unavailable` so it is visible
 *     instead of looking like a quiet day.
 */

import { getPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";

/** Outcome of asking PayPal what an invoice payment cost. */
export type InvoiceFeeLookup =
  | { status: "found"; fee: number }
  /** PayPal has not reported the transaction (or its fee) yet. Retry later. */
  | { status: "pending" }
  /** The lookup itself failed, e.g. Transaction Search is not enabled. */
  | { status: "unavailable"; reason: string };

/** One PayPal-processed payment recorded against an invoice. */
export interface InvoicePayPalPayment {
  /** PayPal transaction id, usable with Transaction Search. */
  transactionId: string;
}

/** Payment methods PayPal processes itself, as opposed to externally recorded ones. */
const PAYPAL_PROCESSED_METHODS = new Set(["PAYPAL", "CREDIT_CARD", "DEBIT_CARD"]);

/**
 * Picks the PayPal-processed payments out of a "show invoice details" response.
 *
 * An invoice can also carry EXTERNAL payments (cash, check) that someone recorded
 * on PayPal by hand. Those have no PayPal transaction and no fee, so they are
 * excluded.
 *
 * @param invoice - Parsed JSON body from GET /v2/invoicing/invoices/{id}.
 * @returns Every payment with a PayPal transaction id, possibly none.
 */
export function parseInvoicePayPalPayments(invoice: unknown): InvoicePayPalPayment[] {
  if (typeof invoice !== "object" || invoice === null) return [];
  const payments = (invoice as { payments?: { transactions?: unknown } }).payments;
  const transactions = payments?.transactions;
  if (!Array.isArray(transactions)) return [];

  const found: InvoicePayPalPayment[] = [];
  for (const entry of transactions) {
    if (typeof entry !== "object" || entry === null) continue;
    const { type, method, payment_id: paymentId } = entry as {
      type?: unknown;
      method?: unknown;
      payment_id?: unknown;
    };
    if (type === "EXTERNAL") continue;
    if (typeof method !== "string" || !PAYPAL_PROCESSED_METHODS.has(method)) continue;
    if (typeof paymentId !== "string" || paymentId.length === 0) continue;
    found.push({ transactionId: paymentId });
  }
  return found;
}

/**
 * Reads the fee off a Transaction Search response for one transaction id.
 *
 * PayPal can list the same id twice (a balance-affecting row and a
 * non-balance-affecting one) and both may carry the fee, so rows are not summed;
 * the largest fee wins. `fee_amount` is negative, so the magnitude is returned.
 * A row with no fee value yields null, never zero: PayPal fills the field only
 * once the fee has been processed.
 *
 * @param body - Parsed JSON from GET /v1/reporting/transactions.
 * @param transactionId - The transaction the fee belongs to.
 * @returns Fee in dollars (positive), or null when PayPal reports none yet.
 */
export function parseTransactionSearchFee(
  body: unknown,
  transactionId: string
): number | null {
  if (typeof body !== "object" || body === null) return null;
  const details = (body as { transaction_details?: unknown }).transaction_details;
  if (!Array.isArray(details)) return null;

  let largest: number | null = null;
  for (const detail of details) {
    const info = (detail as { transaction_info?: Record<string, unknown> } | null)
      ?.transaction_info;
    if (!info || info.transaction_id !== transactionId) continue;
    const raw = (info.fee_amount as { value?: unknown } | undefined)?.value;
    if (typeof raw !== "string") continue;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) continue;
    const magnitude = Math.abs(parsed);
    if (largest === null || magnitude > largest) largest = magnitude;
  }
  return largest;
}

/** Days either side of the payment date searched. Transaction Search allows 31 in total. */
const SEARCH_WINDOW_DAYS = 14;

/** Formats a date the way Transaction Search expects (ISO 8601, UTC, no millis). */
function searchTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Looks up what PayPal charged to collect a paid PayPal invoice.
 *
 * Side effects: up to 1 + N PayPal API reads (invoice, then one Transaction
 * Search per PayPal payment). Never writes to PayPal.
 *
 * @param platformInvoiceId - The PayPal invoice id (`invoices.platform_invoice_id`).
 * @param paidAt - When our system recorded the invoice as paid; centres the search window.
 * @returns The summed fee across the invoice's PayPal payments, `pending` when
 *          PayPal has not reported it yet, or `unavailable` when the lookup failed.
 */
export async function lookupInvoicePayPalFee(
  platformInvoiceId: string,
  paidAt: Date
): Promise<InvoiceFeeLookup> {
  let accessToken: string;
  try {
    accessToken = await getPayPalAccessToken();
  } catch (err) {
    return { status: "unavailable", reason: `PayPal auth failed: ${String(err)}` };
  }
  const headers = { Authorization: `Bearer ${accessToken}` };
  const apiBase = getPayPalApiBase();

  const invoiceResponse = await fetch(
    `${apiBase}/v2/invoicing/invoices/${encodeURIComponent(platformInvoiceId)}`,
    { headers, cache: "no-store" }
  ).catch((err: unknown) => err);
  if (invoiceResponse instanceof Error || !(invoiceResponse instanceof Response)) {
    return { status: "unavailable", reason: "PayPal invoice lookup could not connect" };
  }
  if (!invoiceResponse.ok) {
    return {
      status: "unavailable",
      reason: `PayPal invoice lookup returned ${invoiceResponse.status}`,
    };
  }

  const payments = parseInvoicePayPalPayments(await invoiceResponse.json().catch(() => null));
  // PayPal has not attached the payment to the invoice yet.
  if (payments.length === 0) return { status: "pending" };

  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(paidAt.getTime() - SEARCH_WINDOW_DAYS * dayMs);
  const end = new Date(Math.min(Date.now(), paidAt.getTime() + SEARCH_WINDOW_DAYS * dayMs));

  let totalFee = 0;
  for (const payment of payments) {
    const query = new URLSearchParams({
      transaction_id: payment.transactionId,
      start_date: searchTimestamp(start),
      end_date: searchTimestamp(end),
      fields: "transaction_info",
    });
    const searchResponse = await fetch(`${apiBase}/v1/reporting/transactions?${query}`, {
      headers,
      cache: "no-store",
    }).catch((err: unknown) => err);

    if (searchResponse instanceof Error || !(searchResponse instanceof Response)) {
      return { status: "unavailable", reason: "Transaction Search could not connect" };
    }
    if (!searchResponse.ok) {
      return {
        status: "unavailable",
        reason: `Transaction Search returned ${searchResponse.status}`,
      };
    }

    const fee = parseTransactionSearchFee(
      await searchResponse.json().catch(() => null),
      payment.transactionId
    );
    // One payment without a fee yet means the total would be understated.
    if (fee === null) return { status: "pending" };
    totalFee += fee;
  }

  return { status: "found", fee: Math.round(totalFee * 100) / 100 };
}

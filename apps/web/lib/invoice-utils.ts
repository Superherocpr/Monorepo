/**
 * Shared display utilities for the invoice system.
 * Used by: InvoicesClient, InvoiceDetailClient, CreateInvoiceClient
 *
 * Centralises formatting, label maps, and badge config so they never
 * fall out of sync across the three invoice UI components.
 */

import type { InvoicePaymentMethod, InvoiceStatus } from "@/types/invoices";
import type { PaymentPlatform } from "@/types/users";

/**
 * Formats a number as USD currency with comma separators.
 * e.g. 1500 → "$1,500.00"
 * @param amount - Dollar amount as a float
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Formats an ISO date string as "Mon DD, YYYY".
 * e.g. "2026-05-15T14:00:00Z" → "May 15, 2026"
 * @param iso - ISO 8601 date string
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats an ISO date string as "Mon DD, YYYY at H:MM AM/PM".
 * e.g. "2026-05-15T14:00:00Z" → "May 15, 2026 at 2:00 PM"
 * @param iso - ISO 8601 date string
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Maps InvoiceStatus values to a display label and Tailwind badge CSS classes. */
export const STATUS_BADGES: Record<InvoiceStatus, { label: string; classes: string }> = {
  sent: { label: "Sent", classes: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", classes: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", classes: "bg-gray-100 text-gray-500" },
};

/** Display labels for the ways an invoice can be paid, in the order they are offered. */
export const PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  paypal: "PayPal",
  check: "Check",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

/** Maps PaymentPlatform values to human-readable display labels. */
export const PLATFORM_LABELS: Record<PaymentPlatform, string> = {
  paypal: "PayPal",
  square: "Square",
  stripe: "Stripe",
  venmo_business: "Venmo Business",
};

/** An invoice already raised for a class, as the Create Invoice form needs it to spot duplicates. */
export interface ExistingClassInvoice {
  id: string;
  invoice_number: string;
  recipient_email: string;
  status: InvoiceStatus;
  total_amount: number;
}

/**
 * Finds invoices already sent to the same email for a class, so Create Invoice
 * can warn before the customer is billed twice. Cancelled invoices are ignored
 * (they are void); paid ones still count, since billing a paid customer again
 * is exactly the mistake worth catching.
 * @param existing - The class's invoices.
 * @param email - The recipient email being typed; compared trimmed and case-insensitively.
 * @returns The matching invoices, or an empty list.
 */
export function findInvoicesForRecipient(
  existing: ExistingClassInvoice[],
  email: string
): ExistingClassInvoice[] {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return [];
  return existing.filter(
    (inv) => inv.status !== "cancelled" && inv.recipient_email.trim().toLowerCase() === wanted
  );
}

/**
 * Shared display utilities for the invoice system.
 * Used by: InvoicesClient, InvoiceDetailClient, CreateInvoiceClient
 *
 * Centralises formatting, label maps, and badge config so they never
 * fall out of sync across the three invoice UI components.
 */

import type { InvoiceStatus } from "@/types/invoices";
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

/** Maps PaymentPlatform values to human-readable display labels. */
export const PLATFORM_LABELS: Record<PaymentPlatform, string> = {
  paypal: "PayPal",
  square: "Square",
  stripe: "Stripe",
  venmo_business: "Venmo Business",
};

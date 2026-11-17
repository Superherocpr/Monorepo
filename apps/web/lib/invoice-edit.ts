/**
 * invoice-edit.ts: pure rules for editing a sent, unpaid invoice.
 * Used by: POST /api/invoices/edit (validation and server-side totals) and
 *          InvoiceDetailClient (pre-filling the form and the live total).
 *
 * Pure and dependency-free (besides the shared travel-fee check) so the form
 * and the server compute the same numbers.
 *
 * The travel fee is stored on invoices.travel_fee (migration 0081) and is part
 * of total_amount: total = students x price + travel fee.
 */

import { validateTravelFee } from "@/lib/team-travel-fee";
import type { InvoiceLineItem } from "@/lib/invoice-actions";

/** Upper bound on an edited student count, a typo guard rather than a business rule. */
export const INVOICE_EDIT_MAX_STUDENTS = 500;

/** Upper bound on an edited per-student price, a typo guard rather than a business rule. */
export const INVOICE_EDIT_MAX_PRICE = 10000;

/** Rounds a dollar amount to whole cents, avoiding float drift in totals. */
function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Computes the invoice total from its three editable parts.
 * @param studentCount - Number of students billed.
 * @param amountPerStudent - Price per student in dollars.
 * @param travelFee - Flat travel fee in dollars (0 for none).
 * @returns The total in dollars, rounded to cents.
 */
export function computeInvoiceTotal(
  studentCount: number,
  amountPerStudent: number,
  travelFee: number
): number {
  return toCents(studentCount * amountPerStudent + travelFee);
}

/**
 * Checks the editable numbers of an invoice.
 * @param input - The requested student count, price and travel fee. For a flat
 *                team invoice (`flat`), the price is the whole base price, there
 *                is no student count to check, and the price must be above zero
 *                because PayPal rejects an invoice with nothing to pay.
 * @returns A message safe to show staff, or null when everything is acceptable.
 */
export function validateInvoiceEdit(input: {
  studentCount: unknown;
  amountPerStudent: unknown;
  travelFee: unknown;
  flat?: boolean;
}): string | null {
  const { studentCount, amountPerStudent, travelFee, flat = false } = input;
  if (flat) {
    if (
      typeof amountPerStudent !== "number" ||
      !Number.isFinite(amountPerStudent) ||
      amountPerStudent <= 0 ||
      amountPerStudent > INVOICE_EDIT_MAX_PRICE * INVOICE_EDIT_MAX_STUDENTS
    ) {
      return "The price must be a number above zero.";
    }
    if (typeof travelFee !== "number") return "The travel fee must be a number.";
    return validateTravelFee(travelFee);
  }
  if (
    typeof studentCount !== "number" ||
    !Number.isInteger(studentCount) ||
    studentCount < 1 ||
    studentCount > INVOICE_EDIT_MAX_STUDENTS
  ) {
    return `Student count must be a whole number from 1 to ${INVOICE_EDIT_MAX_STUDENTS}.`;
  }
  if (
    typeof amountPerStudent !== "number" ||
    !Number.isFinite(amountPerStudent) ||
    amountPerStudent < 0 ||
    amountPerStudent > INVOICE_EDIT_MAX_PRICE
  ) {
    return "Price per student must be a number of zero or more.";
  }
  if (typeof travelFee !== "number") return "The travel fee must be a number.";
  return validateTravelFee(travelFee);
}

/**
 * Builds the PayPal line items for an edited invoice, in the same shape
 * createAndSendInvoice uses: the per-student class fee, then a travel fee line
 * only when there is one (PayPal rejects a zero-priced line the business did
 * not intend, and a blank "Travel Fee" row would confuse the customer).
 * @param className - Class name shown on the first line.
 * @param studentCount - Number of students billed.
 * @param amountPerStudent - Price per student in dollars.
 * @param travelFee - Flat travel fee in dollars (0 for none).
 * @returns The ordered line items.
 */
export function buildEditedLineItems(
  className: string,
  studentCount: number,
  amountPerStudent: number,
  travelFee: number
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [
    { name: className, quantity: studentCount, unitAmount: amountPerStudent },
  ];
  if (travelFee > 0) {
    items.push({ name: "Travel Fee", quantity: 1, unitAmount: travelFee });
  }
  return items;
}

/**
 * Rebuilds the PayPal line items of a flat team invoice with a new price and
 * travel fee, keeping PayPal's own line names (the first line's name carries a
 * description we do not store, e.g. "Corporate Training: BLS (12 people at $85
 * each)"). The first line is the flat price; a later line named like travel is
 * the travel fee, which is dropped when the new fee is 0 and added, with the
 * default name, when there was none.
 * @param current - The invoice's line items as PayPal holds them now.
 * @param basePrice - The new flat price in dollars.
 * @param travelFee - The new travel fee in dollars (0 for none).
 * @returns The new line items, or null when the invoice has lines this cannot
 *          rebuild without guessing (the caller then refuses the edit).
 */
export function rebuildFlatLineItems(
  current: InvoiceLineItem[],
  basePrice: number,
  travelFee: number
): InvoiceLineItem[] | null {
  if (current.length === 0) return null;
  const [primary, ...rest] = current;
  if (rest.some((item) => !/travel/i.test(item.name)) || rest.length > 1) return null;

  const items: InvoiceLineItem[] = [{ name: primary.name, quantity: 1, unitAmount: basePrice }];
  if (travelFee > 0) {
    items.push({
      name: rest[0]?.name ?? "Travel & Setup Fee",
      quantity: 1,
      unitAmount: travelFee,
    });
  }
  return items;
}

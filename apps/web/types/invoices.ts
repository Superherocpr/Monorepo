/**
 * TypeScript interfaces for invoice database tables.
 * Covers: invoices, invoice_activity_log.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */
import type { PaymentPlatform } from "@/types/users";

/** Invoice type values for invoices.invoice_type enum. */
export type InvoiceType = "individual" | "group";

/** Invoice status values for invoices.status enum. */
export type InvoiceStatus = "sent" | "paid" | "cancelled";

/**
 * An invoice record from the `invoices` table.
 * invoice_number (e.g. "INV-00042") is used as the roster upload lookup key.
 */
export interface Invoice {
  id: string;
  invoice_number: string;
  class_session_id: string;
  instructor_id: string;
  invoice_type: InvoiceType;
  recipient_name: string;
  recipient_email: string;
  company_name: string | null;
  student_count: number;
  amount_per_student: number;
  custom_price: boolean;
  total_amount: number;
  payment_platform: PaymentPlatform;
  platform_invoice_id: string | null;
  status: InvoiceStatus;
  notes: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

/**
 * An audit log entry for invoice actions from the `invoice_activity_log` table.
 * e.g. "created", "sent", "marked_paid", "cancelled", "resent".
 */
export interface InvoiceActivityLog {
  id: string;
  invoice_id: string;
  actor_id: string;
  action: string;
  notes: string | null;
  created_at: string;
}

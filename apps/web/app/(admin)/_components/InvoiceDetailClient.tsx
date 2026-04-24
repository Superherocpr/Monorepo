"use client";

/**
 * InvoiceDetailClient — Interactive invoice detail view for /admin/invoices/[id].
 * Handles Mark as Paid, Resend, and Cancel Invoice actions inline.
 * Used by: InvoiceDetailPage (admin/invoices/[id]/page.tsx)
 */

import { useState } from "react";
import Link from "next/link";
import type { InvoiceStatus, InvoiceType } from "@/types/invoices";
import type { PaymentPlatform, UserRole } from "@/types/users";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Activity log entry joined with the actor's profile. */
export interface ActivityLogEntry {
  id: string;
  action: string;
  notes: string | null;
  created_at: string;
  profiles: { first_name: string; last_name: string } | null;
}

/** Full invoice detail row as returned by the server. */
export interface InvoiceDetail {
  id: string;
  invoice_number: string;
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
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  class_sessions: {
    id: string;
    starts_at: string;
    ends_at: string;
    class_types: { name: string } | null;
    locations: {
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    } | null;
  } | null;
  /** Instructor who owns the invoice. */
  profiles: { id: string; first_name: string; last_name: string } | null;
  invoice_activity_log: ActivityLogEntry[];
}

interface InvoiceDetailClientProps {
  invoice: InvoiceDetail;
  userRole: UserRole;
  userId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a number as USD currency.
 * @param amount - Dollar amount
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Formats an ISO date string as "Mon DD, YYYY".
 * @param iso - ISO 8601 date string
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats an ISO date string as "Mon DD, YYYY at H:MM AM/PM".
 * @param iso - ISO 8601 date string
 */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Maps InvoiceStatus to display label and badge classes. */
const STATUS_BADGES: Record<InvoiceStatus, { label: string; classes: string }> = {
  sent: { label: "Sent", classes: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", classes: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", classes: "bg-gray-100 text-gray-500" },
};

/** Maps PaymentPlatform to a display label. */
const PLATFORM_LABELS: Record<PaymentPlatform, string> = {
  paypal: "PayPal",
  square: "Square",
  stripe: "Stripe",
  venmo_business: "Venmo Business",
};

/** Maps raw action strings to readable labels for the activity log. */
const ACTION_LABELS: Record<string, string> = {
  created: "Invoice created",
  sent: "Invoice sent",
  resent: "Invoice resent",
  marked_paid: "Marked as paid",
  cancelled: "Invoice cancelled",
};

// ─── Action panel states ──────────────────────────────────────────────────────

type ActionMode = "idle" | "confirm-paid" | "resend" | "confirm-cancel";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Full invoice detail view with inline action panels for paid/resend/cancel.
 * Managers see all details but no action buttons.
 * Instructors can only act on their own invoices.
 * @param invoice - The full invoice record with all joined relations
 * @param userRole - The current user's role
 * @param userId - The current user's profile ID
 */
export default function InvoiceDetailClient({
  invoice,
  userRole,
  userId,
}: InvoiceDetailClientProps) {
  const isManager = userRole === "manager";
  const isSuperAdmin = userRole === "super_admin";
  const isOwner = invoice.profiles?.id === userId;
  // Instructors can act on their own; super admins can act on all; managers view only
  const canAct = isSuperAdmin || (userRole === "instructor" && isOwner);

  const [actionMode, setActionMode] = useState<ActionMode>("idle");
  const [resendEmail, setResendEmail] = useState(invoice.recipient_email);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Current status for reactive UI after actions
  const [currentStatus, setCurrentStatus] = useState<InvoiceStatus>(invoice.status);
  const [currentPaidAt, setCurrentPaidAt] = useState(invoice.paid_at);
  const [currentCancelledAt, setCurrentCancelledAt] = useState(invoice.cancelled_at);

  const badge = STATUS_BADGES[currentStatus];
  const session = invoice.class_sessions;
  const instructorName = invoice.profiles
    ? `${invoice.profiles.first_name} ${invoice.profiles.last_name}`
    : "—";

  /** Calls an invoice action API route and handles state updates. */
  async function callAction(
    url: string,
    body: Record<string, string>,
    onSuccess: () => void
  ) {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) {
        setErrorMsg(data.error ?? "Something went wrong.");
      } else {
        onSuccess();
        setActionMode("idle");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleMarkPaid() {
    callAction(
      "/api/invoices/mark-paid",
      { invoiceId: invoice.id },
      () => {
        setCurrentStatus("paid");
        setCurrentPaidAt(new Date().toISOString());
        setSuccessMsg("Invoice marked as paid. Booking spots have been reserved.");
      }
    );
  }

  function handleResend() {
    if (!resendEmail.trim()) return;
    callAction(
      "/api/invoices/resend",
      { invoiceId: invoice.id, newEmail: resendEmail.trim() },
      () => {
        setSuccessMsg(`Invoice resent to ${resendEmail.trim()}.`);
      }
    );
  }

  function handleCancel() {
    callAction(
      "/api/invoices/cancel",
      { invoiceId: invoice.id },
      () => {
        setCurrentStatus("cancelled");
        setCurrentCancelledAt(new Date().toISOString());
        setSuccessMsg(`Invoice cancelled and voided on ${PLATFORM_LABELS[invoice.payment_platform]}.`);
      }
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col lg:flex-row gap-8">

        {/* ── Main content ────────────────────────────────────────────────────── */}
        <div className="flex-1 space-y-6">

          {/* Invoice header */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="font-mono text-2xl font-bold text-gray-900">
                  {invoice.invoice_number}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  Sent {formatDate(invoice.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${badge.classes}`}
                >
                  {badge.label}
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  {PLATFORM_LABELS[invoice.payment_platform]}
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  {invoice.invoice_type === "group" ? "Group" : "Individual"}
                </span>
              </div>
            </div>
          </div>

          {/* Recipient details */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Recipient</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-500">Name</dt>
                <dd className="font-medium text-gray-900">{invoice.recipient_name}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Email</dt>
                <dd className="text-gray-900">{invoice.recipient_email}</dd>
              </div>
              {invoice.company_name && (
                <div>
                  <dt className="text-gray-500">Company</dt>
                  <dd className="text-gray-900">{invoice.company_name}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Class details */}
          {session && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Class</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-500">Type</dt>
                  <dd className="font-medium text-gray-900">
                    {session.class_types?.name ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Date &amp; Time</dt>
                  <dd className="text-gray-900">{formatDateTime(session.starts_at)}</dd>
                </div>
                {session.locations && (
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">Location</dt>
                    <dd className="text-gray-900">
                      {session.locations.name}<br />
                      {session.locations.address}<br />
                      {session.locations.city}, {session.locations.state} {session.locations.zip}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-gray-500">Instructor</dt>
                  <dd className="text-gray-900">{instructorName}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* Invoice summary */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Students</dt>
                <dd className="text-gray-900">
                  {invoice.student_count} student{invoice.student_count !== 1 ? "s" : ""}
                </dd>
              </div>
              {!invoice.custom_price && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Per student</dt>
                  <dd className="text-gray-900">{formatCurrency(invoice.amount_per_student)}</dd>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                <dt className="font-semibold text-gray-900">Total</dt>
                <dd className="text-xl font-bold text-gray-900">
                  {formatCurrency(invoice.total_amount)}
                  {invoice.custom_price && (
                    <span className="ml-2 text-xs font-medium px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                      Custom price
                    </span>
                  )}
                </dd>
              </div>
              {currentPaidAt && (
                <div className="flex justify-between text-green-600 font-medium pt-1">
                  <dt>Paid</dt>
                  <dd>{formatDate(currentPaidAt)}</dd>
                </div>
              )}
              {currentCancelledAt && (
                <div className="flex justify-between text-gray-400 pt-1">
                  <dt>Cancelled</dt>
                  <dd>{formatDate(currentCancelledAt)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Custom note */}
          {invoice.notes && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-2">Note to Recipient</h2>
              <p className="text-sm text-gray-700">{invoice.notes}</p>
            </div>
          )}

          {/* Activity log */}
          {invoice.invoice_activity_log.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Activity</h2>
              <ol className="space-y-3">
                {[...invoice.invoice_activity_log]
                  .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                  .map((entry) => (
                    <li key={entry.id} className="flex gap-3 text-sm">
                      <div className="mt-0.5 w-2 h-2 rounded-full bg-gray-300 shrink-0 mt-1.5" />
                      <div>
                        <span className="font-medium text-gray-900">
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        {entry.profiles && (
                          <span className="text-gray-500">
                            {" "}by {entry.profiles.first_name} {entry.profiles.last_name}
                          </span>
                        )}
                        <span className="text-gray-400 ml-2">
                          {formatDateTime(entry.created_at)}
                        </span>
                        {entry.notes && (
                          <p className="text-gray-500 mt-0.5">{entry.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </div>

        {/* ── Actions sidebar ──────────────────────────────────────────────────── */}
        <div className="lg:w-72 shrink-0 space-y-4">

          {/* Success message */}
          {successMsg && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
              {successMsg}
            </div>
          )}

          {/* Error message */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Actions</h2>

            {/* Status: sent — show all actions if canAct */}
            {currentStatus === "sent" && canAct && actionMode === "idle" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setActionMode("confirm-paid")}
                  className="w-full px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors"
                >
                  Mark as Paid
                </button>
                <button
                  type="button"
                  onClick={() => { setResendEmail(invoice.recipient_email); setActionMode("resend"); }}
                  className="w-full px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
                >
                  Resend Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setActionMode("confirm-cancel")}
                  className="w-full px-4 py-2 border border-red-300 text-red-700 text-sm font-medium rounded-md hover:bg-red-50 transition-colors"
                >
                  Cancel Invoice
                </button>
              </div>
            )}

            {/* Confirm mark paid */}
            {actionMode === "confirm-paid" && (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  Confirm this invoice has been paid manually?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActionMode("idle")}
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 border border-gray-300 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkPaid}
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    {loading ? "Saving…" : "Confirm — Mark Paid"}
                  </button>
                </div>
              </div>
            )}

            {/* Resend form */}
            {actionMode === "resend" && (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="resend-email"
                    className="block text-xs font-medium text-gray-500 mb-1"
                  >
                    Send to
                  </label>
                  <input
                    id="resend-email"
                    type="email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Update the address if the original was incorrect.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActionMode("idle")}
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 border border-gray-300 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading || !resendEmail.trim()}
                    className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loading ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}

            {/* Confirm cancel */}
            {actionMode === "confirm-cancel" && (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  Cancelling this invoice will void it on{" "}
                  <strong>{PLATFORM_LABELS[invoice.payment_platform]}</strong> and
                  it cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActionMode("idle")}
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 border border-gray-300 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    {loading ? "Cancelling…" : "Confirm Cancellation"}
                  </button>
                </div>
              </div>
            )}

            {/* Status: paid — no actions */}
            {currentStatus === "paid" && (
              <p className="text-sm text-green-700 font-medium">
                This invoice has been paid.
              </p>
            )}

            {/* Status: cancelled — no actions, offer re-issue link */}
            {currentStatus === "cancelled" && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">This invoice has been cancelled.</p>
                {(isSuperAdmin || (userRole === "instructor" && isOwner)) && session && (
                  <Link
                    href={`/admin/invoices/new?session=${session.id}`}
                    className="block w-full text-center px-4 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Create New Invoice
                  </Link>
                )}
              </div>
            )}

            {/* Managers — view only notice */}
            {isManager && currentStatus === "sent" && (
              <p className="text-xs text-gray-400">
                Managers can view invoices but cannot take actions. Contact the instructor or super admin.
              </p>
            )}
          </div>

          {/* Back link */}
          <Link
            href="/admin/invoices"
            className="block text-center text-sm text-gray-400 hover:text-gray-600"
          >
            ← Back to Invoices
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * InvoicesClient — Filterable invoice list for /admin/invoices.
 * Handles client-side filtering by status, type, date range, instructor, and class.
 * Used by: InvoicesPage (admin/invoices/page.tsx)
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { InvoiceStatus, InvoiceType } from "@/types/invoices";
import type { PaymentPlatform } from "@/types/users";
import type { UserRole } from "@/types/users";

// ─── Types ────────────────────────────────────────────────────────────────────

/** An invoice row as returned by the Supabase query with joined relations. */
export interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_type: InvoiceType;
  recipient_name: string;
  recipient_email: string;
  company_name: string | null;
  student_count: number;
  total_amount: number;
  status: InvoiceStatus;
  payment_platform: PaymentPlatform;
  custom_price: boolean;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  class_sessions: {
    id: string;
    starts_at: string;
    class_types: { name: string } | null;
  } | null;
  /** Instructor profile — populated for all invoices; shown only for manager/super admin views. */
  profiles: { first_name: string; last_name: string } | null;
}

/** An instructor entry for the filter dropdown (manager/super admin only). */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface InvoicesClientProps {
  invoices: InvoiceRow[];
  instructors: InstructorOption[];
  userRole: UserRole;
  userId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a number as USD currency, e.g. 1500 → "$1,500.00".
 * @param amount - Numeric amount in dollars
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

/** Maps InvoiceStatus to display label and Tailwind badge classes. */
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

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the full invoices list page with client-side filtering.
 * Instructors see only their own invoices (enforced server-side; not re-checked here).
 * Managers and super admins see all invoices including instructor name.
 * @param invoices - All invoice rows fetched server-side
 * @param instructors - Instructor options for filter dropdown (empty for instructor role)
 * @param userRole - The current user's role, used to control UI visibility
 * @param userId - The current user's profile ID
 */
export default function InvoicesClient({
  invoices,
  instructors,
  userRole,
  userId,
}: InvoicesClientProps) {
  const isManager = userRole === "manager" || userRole === "super_admin";
  // Instructors and super admins can create invoices; managers cannot
  const canCreate = userRole === "instructor" || userRole === "super_admin";

  // ─── Filter state ───────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | "all">("sent");
  const [filterType, setFilterType] = useState<InvoiceType | "all">("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterInstructor, setFilterInstructor] = useState("all");
  const [filterClass, setFilterClass] = useState("all");

  // ─── Build class options from the invoices data ─────────────────────────────
  const classOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.class_sessions) {
        const { id, starts_at, class_types } = inv.class_sessions;
        if (!seen.has(id)) {
          const label = `${class_types?.name ?? "Unknown"} — ${formatDate(starts_at)}`;
          seen.set(id, label);
        }
      }
    }
    return Array.from(seen.entries()); // [sessionId, label]
  }, [invoices]);

  // ─── Apply filters ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (filterStatus !== "all" && inv.status !== filterStatus) return false;
      if (filterType !== "all" && inv.invoice_type !== filterType) return false;
      if (filterInstructor !== "all") {
        // Derive instructor ID from profiles — we don't store it in InvoiceRow,
        // so we match by checking the invoice's instructor against the dropdown value
        // via the instructors list (matched by name is fragile; use stored id if available).
        // The page passes invoices that already scoped to the user for instructors,
        // so this filter only runs for manager/super_admin views.
        const instr = instructors.find(
          (i) => `${i.first_name} ${i.last_name}` === filterInstructor
        );
        if (instr) {
          const fullName = `${inv.profiles?.first_name ?? ""} ${inv.profiles?.last_name ?? ""}`.trim();
          if (fullName !== filterInstructor) return false;
        }
      }
      if (filterClass !== "all" && inv.class_sessions?.id !== filterClass) return false;
      if (filterFrom) {
        if (new Date(inv.created_at) < new Date(filterFrom)) return false;
      }
      if (filterTo) {
        // Include the full "to" day
        const to = new Date(filterTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(inv.created_at) > to) return false;
      }
      return true;
    });
  }, [invoices, filterStatus, filterType, filterInstructor, filterClass, filterFrom, filterTo, instructors]);

  // ─── Empty state ────────────────────────────────────────────────────────────
  const isEmpty = invoices.length === 0;

  return (
    <div>
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-4 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
            <p className="mt-1 text-sm text-gray-500">
              {filtered.length} invoice{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          {canCreate && (
            <Link
              href="/admin/invoices/new"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Invoice
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Filter bar */}
        {!isEmpty && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-3 items-end">
            {/* Status */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as InvoiceStatus | "all")}
                className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Invoice type */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as InvoiceType | "all")}
                className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All</option>
                <option value="individual">Individual</option>
                <option value="group">Group</option>
              </select>
            </div>

            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">From</label>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">To</label>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Instructor — manager/super admin only */}
            {isManager && instructors.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Instructor</label>
                <select
                  value={filterInstructor}
                  onChange={(e) => setFilterInstructor(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All instructors</option>
                  {instructors.map((i) => (
                    <option key={i.id} value={`${i.first_name} ${i.last_name}`}>
                      {i.first_name} {i.last_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Class */}
            {classOptions.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Class</label>
                <select
                  value={filterClass}
                  onChange={(e) => setFilterClass(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All classes</option>
                  {classOptions.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Clear filters */}
            <button
              type="button"
              onClick={() => {
                setFilterStatus("sent");
                setFilterType("all");
                setFilterFrom("");
                setFilterTo("");
                setFilterInstructor("all");
                setFilterClass("all");
              }}
              className="text-xs text-gray-400 hover:text-gray-600 underline self-end pb-1.5"
            >
              Reset
            </button>
          </div>
        )}

        {/* Invoice list or empty state */}
        {isEmpty ? (
          /* Global empty state — no invoices at all */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="text-gray-300 mb-4" size={48} />
            <p className="text-gray-500 mb-4">No invoices found.</p>
            {canCreate && (
              <Link
                href="/admin/invoices/new"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
              >
                Create Invoice
              </Link>
            )}
          </div>
        ) : filtered.length === 0 ? (
          /* Filtered empty state — invoices exist but none match current filters */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="text-gray-300 mb-4" size={48} />
            <p className="text-gray-500">No invoices match the current filters.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((inv) => {
              const badge = STATUS_BADGES[inv.status];
              const sessionName = inv.class_sessions?.class_types?.name ?? "Unknown class";
              const sessionDate = inv.class_sessions
                ? formatDate(inv.class_sessions.starts_at)
                : "—";
              const instructorName = inv.profiles
                ? `${inv.profiles.first_name} ${inv.profiles.last_name}`
                : null;

              return (
                <div
                  key={inv.id}
                  className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  {/* Left — main info */}
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-700">
                        {inv.invoice_number}
                      </span>
                      {/* Status badge */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                      {/* Custom price badge */}
                      {inv.custom_price && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          Custom price
                        </span>
                      )}
                    </div>

                    {/* Recipient */}
                    <p className="font-semibold text-gray-900 truncate">
                      {inv.invoice_type === "group" && inv.company_name
                        ? `${inv.company_name} (Group)`
                        : inv.recipient_name}
                    </p>

                    {/* Class + date */}
                    <p className="text-sm text-gray-500">
                      {sessionName} · {sessionDate}
                    </p>

                    {/* Instructor — manager/super admin only */}
                    {isManager && instructorName && (
                      <p className="text-sm text-gray-400">
                        Instructor: {instructorName}
                      </p>
                    )}

                    {/* Students + amount */}
                    <div className="flex items-center gap-3 text-sm text-gray-600 flex-wrap">
                      <span>
                        {inv.student_count} student{inv.student_count !== 1 ? "s" : ""}
                      </span>
                      <span className="font-medium text-gray-900">
                        {formatCurrency(inv.total_amount)}
                      </span>
                      <span className="text-gray-400">
                        {PLATFORM_LABELS[inv.payment_platform]}
                      </span>
                    </div>

                    {/* Date metadata */}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                      <span>Sent {formatDate(inv.created_at)}</span>
                      {inv.paid_at && (
                        <span className="text-green-600 font-medium">
                          Paid {formatDate(inv.paid_at)}
                        </span>
                      )}
                      {inv.cancelled_at && (
                        <span>Cancelled {formatDate(inv.cancelled_at)}</span>
                      )}
                    </div>
                  </div>

                  {/* Right — action */}
                  <div className="shrink-0">
                    <Link
                      href={`/admin/invoices/${inv.id}`}
                      className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      View
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

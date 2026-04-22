/**
 * PaymentsClient — client component for the admin payments page.
 * Used by: app/(admin)/admin/payments/page.tsx
 *
 * Owns filter state (navigates to new URL on change), the Log Payment
 * slide-in panel, and success toast. The payment list itself is server-
 * rendered — every filter change triggers a full server fetch.
 */
"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Receipt, X, CheckCircle2, Search } from "lucide-react";
import type { UserRole } from "@/types/users";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single payment row with all joined data. */
interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  payment_type: string;
  paypal_transaction_id: string | null;
  notes: string | null;
  created_at: string;
  logged_by: string | null;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  booking: {
    id: string;
    class_sessions: {
      starts_at: string;
      class_types: { name: string };
      profiles: { first_name: string; last_name: string } | null;
    };
  } | null;
  logged_by_profile: {
    first_name: string;
    last_name: string;
  } | null;
}

/** An instructor option for the filter dropdown. */
interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

/** Active filter values resolved from URL search params. */
interface ActiveFilters {
  type: string | null;
  status: string | null;
  from: string | null;
  to: string | null;
  customer: string | null;
  instructor: string | null;
}

/** All data passed from the server component. */
export interface PaymentsPageData {
  payments: PaymentRow[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  onlineInvoiceTotal: number;
  cashCheckTotal: number;
  instructors: InstructorOption[];
  actorRole: UserRole;
  actorId: string;
  filters: ActiveFilters;
}

/** A customer search result for the Log Payment panel. */
interface CustomerSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** A booking option for the Log Payment panel booking dropdown. */
interface BookingOption {
  id: string;
  session_name: string;
  session_date: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats an ISO date string as "MMM D, YYYY h:mm AM/PM".
 * @param iso - ISO date string from the database.
 */
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats an ISO date string as "MMM D, YYYY" (date only).
 * @param iso - ISO date string from the database.
 */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats a number as USD currency.
 * @param amount - Numeric amount.
 */
function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Returns Tailwind classes for a payment type badge.
 * @param type - payment_type enum value.
 */
function typeBadgeClass(type: string): string {
  switch (type) {
    case "online":
      return "bg-blue-100 text-blue-700";
    case "cash":
      return "bg-gray-100 text-gray-600";
    case "check":
      return "bg-yellow-100 text-yellow-700";
    case "deposit":
      return "bg-purple-100 text-purple-700";
    case "invoice":
      return "bg-teal-100 text-teal-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/**
 * Returns the display label for a payment type.
 * @param type - payment_type enum value.
 */
function typeLabel(type: string): string {
  switch (type) {
    case "online":
      return "Online";
    case "cash":
      return "Cash";
    case "check":
      return "Check";
    case "deposit":
      return "Deposit";
    case "invoice":
      return "Invoice";
    default:
      return type;
  }
}

/**
 * Returns Tailwind classes for a payment status badge.
 * @param status - status enum value.
 */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-700";
    case "pending":
      return "bg-amber-100 text-amber-700";
    case "failed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/**
 * Builds a URL for the payments page with updated search params.
 * Preserves all existing params and only overrides/adds the provided ones.
 * @param base - Current active filters to preserve.
 * @param overrides - Params to add, update, or clear (null removes the param).
 * @param resetPage - Whether to reset the page param to 1. Default true.
 */
function buildUrl(
  base: ActiveFilters & { page?: number },
  overrides: Partial<ActiveFilters & { page: number | null }>,
  resetPage = true
): string {
  const params = new URLSearchParams();

  const merged = { ...base, ...overrides };
  if (resetPage) merged.page = 1;

  if (merged.type) params.set("type", merged.type);
  if (merged.status) params.set("status", merged.status);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.customer) params.set("customer", merged.customer);
  if (merged.instructor) params.set("instructor", merged.instructor);
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));

  const qs = params.toString();
  return `/admin/payments${qs ? `?${qs}` : ""}`;
}

// ── Main component ────────────────────────────────────────────────────────────

/** Full payments page client component with filter bar, list, pagination, and log-payment panel. */
export default function PaymentsClient({ data }: { data: PaymentsPageData }) {
  const {
    payments,
    totalCount,
    totalPages,
    currentPage,
    onlineInvoiceTotal,
    cashCheckTotal,
    instructors,
    actorRole,
    actorId,
    filters,
  } = data;

  const router = useRouter();
  const canAct = actorRole === "manager" || actorRole === "super_admin";

  // ── Filter local state (controlled inputs, navigate on change) ─────────────
  const [customerSearch, setCustomerSearch] = useState(filters.customer ?? "");
  const [showPanel, setShowPanel] = useState(false);

  // ── Log payment panel state ────────────────────────────────────────────────
  const [panelCustomerQuery, setPanelCustomerQuery] = useState("");
  const [panelCustomerResults, setPanelCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [panelCustomer, setPanelCustomer] = useState<CustomerSearchResult | null>(null);
  const [panelCustomerSearching, setPanelCustomerSearching] = useState(false);
  const [panelBookings, setPanelBookings] = useState<BookingOption[]>([]);
  const [panelBookingId, setPanelBookingId] = useState("");
  const [panelType, setPanelType] = useState("cash");
  const [panelAmount, setPanelAmount] = useState("");
  const [panelNotes, setPanelNotes] = useState("");
  const [panelSubmitting, setPanelSubmitting] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const customerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActiveFilters =
    !!filters.type ||
    !!filters.status ||
    !!filters.from ||
    !!filters.to ||
    !!filters.customer ||
    !!filters.instructor;

  // Pagination range display
  const rangeStart = Math.min((currentPage - 1) * 50 + 1, totalCount);
  const rangeEnd = Math.min(currentPage * 50, totalCount);

  // ── Shared styles ──────────────────────────────────────────────────────────
  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";

  // ── Customer search for Log Payment panel (debounced) ──────────────────────

  /**
   * Searches for customers by name or email for the Log Payment panel.
   * Debounced 300ms to avoid excessive API calls.
   * @param query - Search string typed by the user.
   */
  const searchPanelCustomers = useCallback((query: string) => {
    if (customerSearchTimeout.current) {
      clearTimeout(customerSearchTimeout.current);
    }
    if (!query.trim()) {
      setPanelCustomerResults([]);
      return;
    }
    customerSearchTimeout.current = setTimeout(async () => {
      setPanelCustomerSearching(true);
      try {
        const res = await fetch(
          `/api/customers/search?q=${encodeURIComponent(query)}`
        );
        const json = await res.json();
        setPanelCustomerResults(json.customers ?? []);
      } finally {
        setPanelCustomerSearching(false);
      }
    }, 300);
  }, []);

  /**
   * Selects a customer in the Log Payment panel and fetches their bookings.
   * @param customer - The selected customer record.
   */
  async function selectPanelCustomer(customer: CustomerSearchResult) {
    setPanelCustomer(customer);
    setPanelCustomerQuery(`${customer.first_name} ${customer.last_name}`);
    setPanelCustomerResults([]);
    setPanelBookingId("");
    setPanelBookings([]);

    // Fetch their active bookings for the booking dropdown
    const res = await fetch(
      `/api/customers/${customer.id}/bookings-for-payment`
    );
    if (res.ok) {
      const json = await res.json();
      setPanelBookings(json.bookings ?? []);
    }
  }

  /**
   * Resets the panel customer selection so a different customer can be chosen.
   */
  function clearPanelCustomer() {
    setPanelCustomer(null);
    setPanelCustomerQuery("");
    setPanelCustomerResults([]);
    setPanelBookings([]);
    setPanelBookingId("");
  }

  // ── Log payment submit ─────────────────────────────────────────────────────

  /**
   * Submits the Log Payment form to create a new manual payment record.
   * @param e - Form submit event.
   */
  async function handleLogPayment(e: React.FormEvent) {
    e.preventDefault();
    setPanelError(null);

    if (!panelCustomer) {
      setPanelError("Select a customer.");
      return;
    }
    if (!panelBookingId) {
      setPanelError("Select a booking.");
      return;
    }

    const parsedAmount = parseFloat(panelAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setPanelError("Enter a valid amount.");
      return;
    }

    setPanelSubmitting(true);
    try {
      const res = await fetch("/api/payments/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: panelCustomer.id,
          bookingId: panelBookingId,
          paymentType: panelType,
          amount: parsedAmount,
          notes: panelNotes,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setPanelError(json.error ?? "Failed to log payment.");
        return;
      }

      const name = `${panelCustomer.first_name} ${panelCustomer.last_name}`;
      setSuccessToast(`Payment of ${fmtCurrency(parsedAmount)} logged for ${name}.`);
      setTimeout(() => setSuccessToast(null), 5000);

      // Reset panel and navigate to page 1
      setShowPanel(false);
      clearPanelCustomer();
      setPanelType("cash");
      setPanelAmount("");
      setPanelNotes("");
      router.push("/admin/payments");
    } finally {
      setPanelSubmitting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Success toast */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-green-700 px-4 py-3 text-sm font-medium text-white shadow-lg">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successToast}
        </div>
      )}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        {canAct && (
          <button
            onClick={() => setShowPanel(true)}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            + Log Payment
          </button>
        )}
      </div>

      {/* ── Summary strip ────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-4">
          <p className="text-2xl font-bold text-gray-900">
            {fmtCurrency(onlineInvoiceTotal)}
          </p>
          <p className="mt-0.5 text-sm text-gray-500">
            Online &amp; Invoice — This Month
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 p-4">
          <p className="text-2xl font-bold text-gray-900">
            {fmtCurrency(cashCheckTotal)}
          </p>
          <p className="mt-0.5 text-sm text-gray-500">
            Cash &amp; Check — This Month
          </p>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-4">

          {/* Payment type */}
          <div className="min-w-[150px] flex-1">
            <label htmlFor="filter-type" className={labelClass}>
              Payment type
            </label>
            <select
              id="filter-type"
              value={filters.type ?? ""}
              onChange={(e) =>
                router.push(
                  buildUrl(filters, { type: e.target.value || null })
                )
              }
              className={inputClass}
            >
              <option value="">All types</option>
              <option value="online">Online (PayPal)</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="deposit">Deposit</option>
              <option value="invoice">Invoice</option>
            </select>
          </div>

          {/* Date from */}
          <div className="min-w-[140px] flex-1">
            <label htmlFor="filter-from" className={labelClass}>
              From
            </label>
            <input
              id="filter-from"
              type="date"
              value={filters.from ?? ""}
              onChange={(e) =>
                router.push(
                  buildUrl(filters, { from: e.target.value || null })
                )
              }
              className={inputClass}
            />
          </div>

          {/* Date to */}
          <div className="min-w-[140px] flex-1">
            <label htmlFor="filter-to" className={labelClass}>
              To
            </label>
            <input
              id="filter-to"
              type="date"
              value={filters.to ?? ""}
              onChange={(e) =>
                router.push(
                  buildUrl(filters, { to: e.target.value || null })
                )
              }
              className={inputClass}
            />
          </div>

          {/* Customer search */}
          <div className="min-w-[180px] flex-1">
            <label htmlFor="filter-customer" className={labelClass}>
              Customer
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                router.push(
                  buildUrl(filters, {
                    customer: customerSearch.trim() || null,
                  })
                );
              }}
              className="flex gap-1"
            >
              <input
                id="filter-customer"
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Name or email"
                className={inputClass}
              />
              <button
                type="submit"
                className="shrink-0 rounded-md border border-gray-300 px-2 py-2 text-gray-500 hover:bg-gray-50"
                aria-label="Search"
              >
                <Search className="h-4 w-4" />
              </button>
            </form>
          </div>

          {/* Instructor */}
          <div className="min-w-[160px] flex-1">
            <label htmlFor="filter-instructor" className={labelClass}>
              Instructor
            </label>
            <select
              id="filter-instructor"
              value={filters.instructor ?? ""}
              onChange={(e) =>
                router.push(
                  buildUrl(filters, {
                    instructor: e.target.value || null,
                  })
                )
              }
              className={inputClass}
            >
              <option value="">All instructors</option>
              {instructors.map((inst) => (
                <option key={inst.id} value={`${inst.first_name} ${inst.last_name}`}>
                  {inst.first_name} {inst.last_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status pill buttons — always fully visible */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Status:</span>
          {(
            [
              { value: null, label: "All" },
              { value: "completed", label: "Completed" },
              { value: "pending", label: "Pending" },
              { value: "failed", label: "Failed" },
            ] as { value: string | null; label: string }[]
          ).map(({ value, label }) => {
            const active = filters.status === value;
            return (
              <button
                key={label}
                aria-pressed={active}
                onClick={() =>
                  router.push(buildUrl(filters, { status: value }))
                }
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  active
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            );
          })}

          {/* Clear all filters */}
          {hasActiveFilters && (
            <Link
              href="/admin/payments"
              onClick={() => setCustomerSearch("")}
              className="ml-2 text-sm text-red-600 hover:underline"
            >
              Clear all filters
            </Link>
          )}
        </div>
      </div>

      {/* ── Payments list ────────────────────────────────────────────────── */}
      {payments.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white py-16 text-center">
          <Receipt className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">
            No payments found matching your filters.
          </p>
          {hasActiveFilters && (
            <Link
              href="/admin/payments"
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Scrollable table for all screen sizes */}
          <div className="mb-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-[1050px] w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Class
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Instructor
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((pmt) => {
                  const session = pmt.booking?.class_sessions ?? null;
                  const instructor = session?.profiles ?? null;
                  const isManual =
                    pmt.payment_type === "cash" ||
                    pmt.payment_type === "check" ||
                    pmt.payment_type === "deposit";

                  return (
                    <tr key={pmt.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {fmtDateTime(pmt.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {pmt.customer ? (
                          <Link
                            href={`/admin/customers/${pmt.customer.id}`}
                            className="font-medium text-gray-900 hover:text-red-600"
                          >
                            {pmt.customer.first_name} {pmt.customer.last_name}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                        {pmt.customer?.email && (
                          <p className="text-xs text-gray-400">
                            {pmt.customer.email}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {session ? (
                          <>
                            <p className="text-sm text-gray-800">
                              {session.class_types.name}
                            </p>
                            <p className="text-xs text-gray-400">
                              {fmtDate(session.starts_at)}
                            </p>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {instructor
                          ? `${instructor.first_name} ${instructor.last_name}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {fmtCurrency(pmt.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeBadgeClass(pmt.payment_type)}`}
                        >
                          {typeLabel(pmt.payment_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(pmt.status)}`}
                        >
                          {pmt.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pmt.payment_type === "online" &&
                          pmt.paypal_transaction_id && (
                            <p
                              className="max-w-[120px] truncate font-mono text-xs text-gray-500"
                              title={pmt.paypal_transaction_id}
                            >
                              {pmt.paypal_transaction_id}
                            </p>
                          )}
                        {isManual && pmt.logged_by_profile && (
                          <p className="text-xs text-gray-400">
                            Logged by {pmt.logged_by_profile.first_name}{" "}
                            {pmt.logged_by_profile.last_name}
                          </p>
                        )}
                        {pmt.notes && (
                          <p className="text-xs text-gray-400">{pmt.notes}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-600">
              <p>
                Showing {rangeStart}–{rangeEnd} of {totalCount} payments
              </p>
              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={buildUrl(
                      { ...filters, page: currentPage - 1 },
                      {},
                      false
                    )}
                    aria-label="Previous page"
                    className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="rounded-md border border-gray-200 px-3 py-1.5 text-gray-300">
                    ← Previous
                  </span>
                )}
                <span aria-current="page" className="px-2 font-medium">
                  Page {currentPage} of {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={buildUrl(
                      { ...filters, page: currentPage + 1 },
                      {},
                      false
                    )}
                    aria-label="Next page"
                    className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="rounded-md border border-gray-200 px-3 py-1.5 text-gray-300">
                    Next →
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Log Payment slide-in panel ─────────────────────────────────── */}
      {showPanel && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setShowPanel(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Log Payment"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Log Payment
              </h2>
              <button
                onClick={() => setShowPanel(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close panel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleLogPayment}
              className="flex flex-1 flex-col overflow-y-auto px-6 py-6 gap-4"
            >
              {/* Customer search */}
              <div>
                <label htmlFor="panel-customer" className={labelClass}>
                  Customer <span className="text-red-600">*</span>
                </label>
                {panelCustomer ? (
                  <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-900">
                      {panelCustomer.first_name} {panelCustomer.last_name}
                      <span className="ml-1 text-xs text-gray-400">
                        {panelCustomer.email}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={clearPanelCustomer}
                      className="ml-2 text-gray-400 hover:text-gray-600"
                      aria-label="Clear customer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      id="panel-customer"
                      type="text"
                      value={panelCustomerQuery}
                      onChange={(e) => {
                        setPanelCustomerQuery(e.target.value);
                        searchPanelCustomers(e.target.value);
                      }}
                      placeholder="Search by name or email"
                      className={inputClass}
                      autoComplete="off"
                    />
                    {panelCustomerSearching && (
                      <p className="mt-1 text-xs text-gray-400">Searching…</p>
                    )}
                    {panelCustomerResults.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
                        {panelCustomerResults.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => selectPanelCustomer(c)}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                            >
                              <span className="font-medium text-gray-900">
                                {c.first_name} {c.last_name}
                              </span>
                              <span className="ml-2 text-xs text-gray-400">
                                {c.email}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Booking */}
              <div>
                <label htmlFor="panel-booking" className={labelClass}>
                  Booking <span className="text-red-600">*</span>
                </label>
                <select
                  id="panel-booking"
                  required
                  value={panelBookingId}
                  onChange={(e) => setPanelBookingId(e.target.value)}
                  disabled={!panelCustomer}
                  className={inputClass}
                >
                  <option value="">
                    {panelCustomer
                      ? panelBookings.length === 0
                        ? "No bookings found"
                        : "Select a booking…"
                      : "Select a customer first"}
                  </option>
                  {panelBookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.session_name} · {fmtDate(b.session_date)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Payment type */}
              <div>
                <label htmlFor="panel-type" className={labelClass}>
                  Payment type <span className="text-red-600">*</span>
                </label>
                <select
                  id="panel-type"
                  required
                  value={panelType}
                  onChange={(e) => setPanelType(e.target.value)}
                  className={inputClass}
                >
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="deposit">Deposit</option>
                </select>
              </div>

              {/* Amount */}
              <div>
                <label htmlFor="panel-amount" className={labelClass}>
                  Amount ($) <span className="text-red-600">*</span>
                </label>
                <input
                  id="panel-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={panelAmount}
                  onChange={(e) => setPanelAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputClass}
                />
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="panel-notes" className={labelClass}>
                  Notes{" "}
                  <span className="text-xs text-gray-400">(optional)</span>
                </label>
                <textarea
                  id="panel-notes"
                  rows={2}
                  value={panelNotes}
                  onChange={(e) => setPanelNotes(e.target.value)}
                  className={inputClass}
                />
              </div>

              {panelError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {panelError}
                </p>
              )}

              <div className="mt-auto">
                <button
                  type="submit"
                  disabled={panelSubmitting}
                  className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {panelSubmitting ? "Logging…" : "Log Payment"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

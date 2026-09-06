"use client";

/**
 * TeamBookingsClient — interactive list for /admin/team-bookings.
 *
 * Renders every team/corporate booking and, for company-paid ones whose invoice
 * never got raised, offers a one-click retry. The retry hits
 * POST /api/admin/team-bookings/invoice, which re-checks the booking before
 * doing anything, so pressing it twice cannot bill a company twice.
 *
 * Used by: app/(admin)/admin/team-bookings/page.tsx
 */

import { useState, useMemo, useCallback } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { formatClassDateTimeShort } from "@/lib/business-time";

/** One team booking as rendered in the list. */
export interface TeamBookingRow {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  paymentMode: "company" | "per_seat";
  pricePerSeat: number | null;
  totalPrice: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  shareToken: string;
  createdAt: string;
  className: string;
  /** Floating wall-clock ISO of the class start, or null if the session vanished. */
  classStartsAt: string | null;
  sessionStatus: string | null;
  /** Company-paid, past the grace window, and still with no invoice attached. */
  needsInvoice: boolean;
}

/** Which slice of the list is shown. */
type FilterKey = "all" | "uninvoiced";

/** Per-row result of a retry attempt, keyed by team booking id. */
interface RetryState {
  pending: boolean;
  message: string | null;
  ok: boolean;
}

interface Props {
  bookings: TeamBookingRow[];
  initialFilter: FilterKey;
}

/** Formats a dollar amount for display. */
function money(amount: number | null): string {
  if (amount === null) return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Team bookings list with an invoice-recovery action.
 * @param bookings - Every team booking, newest first.
 * @param initialFilter - Which filter to open on; alert emails link in with 'uninvoiced'.
 */
export default function TeamBookingsClient({
  bookings,
  initialFilter,
}: Props): React.ReactElement {
  const [filter, setFilter] = useState<FilterKey>(initialFilter);
  const [retries, setRetries] = useState<Record<string, RetryState>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const uninvoicedCount = useMemo(
    () => bookings.filter((b) => b.needsInvoice).length,
    [bookings]
  );

  const amountAtRisk = useMemo(
    () =>
      bookings
        .filter((b) => b.needsInvoice)
        .reduce((sum, b) => sum + (b.totalPrice ?? 0), 0),
    [bookings]
  );

  const visible = useMemo(
    () => (filter === "uninvoiced" ? bookings.filter((b) => b.needsInvoice) : bookings),
    [bookings, filter]
  );

  const retryInvoice = useCallback(async (bookingId: string): Promise<void> => {
    setRetries((prev) => ({
      ...prev,
      [bookingId]: { pending: true, message: null, ok: false },
    }));

    try {
      const response = await fetch("/api/admin/team-bookings/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_booking_id: bookingId }),
      });

      const body: unknown = await response.json().catch(() => null);
      const record = (typeof body === "object" && body !== null ? body : {}) as Record<
        string,
        unknown
      >;
      const ok = response.ok && record.success === true;
      const message =
        typeof record.message === "string"
          ? record.message
          : typeof record.error === "string"
            ? record.error
            : ok
              ? "Invoice raised."
              : "The invoice could not be raised. Please try again.";

      setRetries((prev) => ({ ...prev, [bookingId]: { pending: false, message, ok } }));

      // A raised invoice changes the row's badge and hides the retry button, so
      // the list is re-fetched from the server rather than patched locally.
      if (ok) setTimeout(() => window.location.reload(), 2500);
    } catch {
      setRetries((prev) => ({
        ...prev,
        [bookingId]: {
          pending: false,
          message: "Could not reach the server. Please try again.",
          ok: false,
        },
      }));
    }
  }, []);

  const copyShareLink = useCallback(async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/team/${token}`);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Clipboard permission denied — the link is still visible in the row.
    }
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Team Bookings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Corporate and group classes booked through a shared signup link. Company-paid bookings
          are invoiced automatically — if that ever fails, the booking shows up here to be retried.
        </p>
      </div>

      {uninvoicedCount > 0 && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold">
              {uninvoicedCount} company booking{uninvoicedCount === 1 ? "" : "s"} worth{" "}
              {money(amountAtRisk)} {uninvoicedCount === 1 ? "has" : "have"} no invoice.
            </p>
            <p className="mt-0.5">
              The company was told the class is booked but has never been asked to pay. Retry each
              one below.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {(["all", "uninvoiced"] as FilterKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={[
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
              filter === key
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400",
            ].join(" ")}
          >
            {key === "all" ? "All bookings" : `Needs invoice${uninvoicedCount ? ` (${uninvoicedCount})` : ""}`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg font-medium">
            {filter === "uninvoiced" ? "Every company booking is invoiced" : "No team bookings yet"}
          </p>
          <p className="text-sm mt-1">
            {filter === "uninvoiced"
              ? "Nothing is waiting to be billed."
              : "Create one from New Session by ticking the team booking box."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((booking) => {
            const retry = retries[booking.id];
            const priceLabel =
              booking.paymentMode === "company"
                ? `${money(booking.totalPrice)} total, billed to the company`
                : `${money(booking.pricePerSeat)} per seat, paid by each employee`;

            return (
              <div
                key={booking.id}
                className={[
                  "bg-white rounded-xl border shadow-sm p-5",
                  booking.needsInvoice ? "border-red-300" : "border-gray-200",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h2 className="font-semibold text-gray-900 truncate">{booking.companyName}</h2>
                      {booking.needsInvoice ? (
                        <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Not invoiced
                        </span>
                      ) : booking.invoiceNumber ? (
                        <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {booking.invoiceNumber} · {booking.invoiceStatus ?? "sent"}
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          {booking.paymentMode === "company" ? "Invoice pending" : "Employees pay"}
                        </span>
                      )}
                      {booking.sessionStatus === "cancelled" && (
                        <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                          Class cancelled
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-gray-500 mb-3">
                      {booking.contactName} — {booking.contactEmail}
                      {booking.contactPhone ? ` — ${booking.contactPhone}` : ""}
                    </p>

                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                      <span>{booking.className}</span>
                      <span>
                        {booking.classStartsAt
                          ? formatClassDateTimeShort(booking.classStartsAt)
                          : "Class removed"}
                      </span>
                      <span className="font-medium text-gray-700">{priceLabel}</span>
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => void copyShareLink(booking.shareToken)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
                    >
                      {copiedToken === booking.shareToken ? (
                        <>
                          <Check className="w-3.5 h-3.5" aria-hidden="true" /> Link copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy signup link
                        </>
                      )}
                    </button>

                    {booking.invoiceId && (
                      <a
                        href={`/admin/invoices/${booking.invoiceId}`}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        View invoice
                      </a>
                    )}

                    {booking.needsInvoice && (
                      <button
                        type="button"
                        onClick={() => void retryInvoice(booking.id)}
                        disabled={retry?.pending || retry?.ok}
                        className="inline-flex items-center gap-1.5 bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${retry?.pending ? "animate-spin" : ""}`}
                          aria-hidden="true"
                        />
                        {retry?.pending ? "Raising…" : "Raise invoice"}
                      </button>
                    )}
                  </div>
                </div>

                {retry?.message && (
                  <p
                    role="status"
                    className={[
                      "mt-3 text-sm rounded-lg px-3 py-2 border",
                      retry.ok
                        ? "bg-green-50 border-green-200 text-green-800"
                        : "bg-red-50 border-red-200 text-red-700",
                    ].join(" ")}
                  >
                    {retry.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

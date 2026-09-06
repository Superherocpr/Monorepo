"use client";

/**
 * RaiseTeamInvoiceButton — recovers a company team booking whose invoice was
 * never raised.
 *
 * Company-paid team bookings are invoiced automatically at creation, but that
 * step is non-fatal by design: the class and share link must survive a PayPal
 * outage. When it fails, `team_bookings.invoice_id` stays null and the company
 * is never asked to pay. This is the operator's way back from that.
 *
 * Shared deliberately — it appears both on the team booking card of a session
 * (in context, on the class it belongs to) and on the Invoices page (where
 * someone chasing unbilled money will look). Both hit the same endpoint, which
 * re-reads the booking before doing anything, so pressing it twice — or racing
 * the nightly sweep — cannot bill a company twice.
 *
 * Used by: SessionDetailClient, InvoicesClient
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

interface Props {
  /** The team_bookings row to raise an invoice for. */
  teamBookingId: string;
  /** Renders the compact variant used inside the Invoices list rows. */
  compact?: boolean;
}

/**
 * Button that raises the missing company invoice for one team booking.
 * Side effects: POST /api/admin/team-bookings/invoice, which on success creates
 * and sends a real PayPal invoice, and a router refresh so the new state shows.
 * @param teamBookingId - The team booking to invoice.
 * @param compact - Use the smaller styling for dense list rows.
 */
export default function RaiseTeamInvoiceButton({
  teamBookingId,
  compact = false,
}: Props): React.ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const handleClick = useCallback(async (): Promise<void> => {
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/team-bookings/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_booking_id: teamBookingId }),
      });

      const body: unknown = await response.json().catch(() => null);
      const record = (typeof body === "object" && body !== null ? body : {}) as Record<
        string,
        unknown
      >;
      const succeeded = response.ok && record.success === true;

      setOk(succeeded);
      setMessage(
        typeof record.message === "string"
          ? record.message
          : typeof record.error === "string"
            ? record.error
            : succeeded
              ? "Invoice raised."
              : "The invoice could not be raised. Please try again."
      );

      // Raising an invoice changes the row's badge and removes this button, so
      // the server state is re-fetched rather than patched locally.
      if (succeeded) router.refresh();
    } catch {
      setOk(false);
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }, [teamBookingId, router]);

  return (
    <div className={compact ? "flex flex-col items-end gap-1" : "space-y-2"}>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending || ok}
        className={[
          "inline-flex items-center gap-1.5 bg-red-600 text-white font-semibold rounded-md",
          "hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors",
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
        ].join(" ")}
      >
        <RefreshCw
          className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} ${pending ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {pending ? "Raising…" : "Raise invoice"}
      </button>

      {message && (
        <p
          role="status"
          className={[
            "text-xs rounded-md px-2.5 py-1.5 border",
            ok
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-700",
          ].join(" ")}
        >
          {message}
        </p>
      )}
    </div>
  );
}

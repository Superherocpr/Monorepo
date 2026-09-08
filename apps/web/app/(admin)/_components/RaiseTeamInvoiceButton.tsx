"use client";

/**
 * RaiseTeamInvoiceButton: bills a company team booking that has no invoice.
 *
 * Two situations reach this button:
 *   - A flat 'company' booking is invoiced automatically at creation, but that
 *     step is non-fatal by design: the class and share link must survive a
 *     PayPal outage. When it fails, `team_bookings.invoice_id` stays null and
 *     the company is never asked to pay. This is the way back from that.
 *   - A 'company_per_signup' booking is billed for however many people signed
 *     up, normally by the sweep after the class. This raises it early, for
 *     whoever has signed up so far.
 *
 * Pressing it sends a real PayPal invoice to the company contact.
 *
 * Shared deliberately: it appears both on the team booking card of a session
 * (in context, on the class it belongs to) and on the Invoices page (where
 * someone chasing unbilled money will look). Both hit the same endpoint, which
 * re-reads the booking before doing anything, so pressing it twice: or racing
 * the nightly sweep: cannot bill a company twice.
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
  /** True once an invoice actually exists, which retires the button. */
  const [ok, setOk] = useState(false);
  /** How to colour the result line: an outcome that billed nothing is neutral. */
  const [tone, setTone] = useState<"success" | "error" | "neutral">("neutral");

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

      // "Nothing to bill" is a successful call that raised no invoice: a
      // per-signup booking nobody has joined yet. The button must stay live, or
      // staff would have to reload the page to bill it once people sign up.
      const nothingToBill = record.status === "nothing_to_bill";

      setOk(succeeded && !nothingToBill);
      setTone(nothingToBill ? "neutral" : succeeded ? "success" : "error");
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
      if (succeeded && !nothingToBill) router.refresh();
    } catch {
      setOk(false);
      setTone("error");
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
            tone === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : tone === "neutral"
                ? "bg-gray-50 border-gray-200 text-gray-700"
                : "bg-red-50 border-red-200 text-red-700",
          ].join(" ")}
        >
          {message}
        </p>
      )}
    </div>
  );
}

"use client";

/**
 * PayoutSettingsClient: interactive payout email form for instructors.
 * Used by: app/(admin)/admin/profile/payment/page.tsx
 */

import React, { useState } from "react";
import { CheckCircle2, WalletCards, AlertTriangle } from "lucide-react";

interface PayoutSettingsClientProps {
  /** Initial PayPal payout email stored on the instructor profile. */
  initialPaypalPayoutEmail: string | null;
}

/** Type guard for the payout email API response. */
function isPayoutEmailResponse(
  value: unknown
): value is { success: boolean; error?: string; paypalPayoutEmail?: string } {
  return typeof value === "object" && value !== null && "success" in value;
}

/**
 * Root client component for the instructor payout settings page.
 * Manages form state, save action, and inline success/error messages.
 */
export default function PayoutSettingsClient({
  initialPaypalPayoutEmail,
}: PayoutSettingsClientProps) {
  const [paypalPayoutEmail, setPaypalPayoutEmail] = useState(
    initialPaypalPayoutEmail ?? ""
  );
  const [savedEmail, setSavedEmail] = useState(initialPaypalPayoutEmail ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /** Saves the PayPal payout email to the instructor profile. */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/profile/payout-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paypalPayoutEmail }),
      });
      const data: unknown = await response.json().catch(() => null);

      if (!response.ok || !isPayoutEmailResponse(data) || !data.success) {
        setMessage({
          type: "error",
          text:
            isPayoutEmailResponse(data) && data.error
              ? data.error
              : "Failed to save payout email.",
        });
        return;
      }

      const normalizedEmail = data.paypalPayoutEmail ?? paypalPayoutEmail.trim().toLowerCase();
      setPaypalPayoutEmail(normalizedEmail);
      setSavedEmail(normalizedEmail);
      setMessage({ type: "success", text: "Payout email saved." });
    } catch {
      setMessage({ type: "error", text: "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const hasSavedEmail = savedEmail.length > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payout Settings</h1>
        <p className="mt-1 max-w-xl text-sm text-gray-600">
          Enter the PayPal email where SuperHeroCPR should send your instructor payouts.
          Customers pay SuperHeroCPR first, then your share is paid out from the admin payout queue.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-full bg-blue-50 p-2 text-blue-700">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">PayPal payout email</h2>
            <p className="mt-1 text-sm text-gray-500">
              This should be the email on the PayPal account that can receive your payouts.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="paypalPayoutEmail" className="block text-sm font-medium text-gray-700">
              PayPal email
            </label>
            <input
              id="paypalPayoutEmail"
              type="email"
              value={paypalPayoutEmail}
              onChange={(event) => setPaypalPayoutEmail(event.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="you@example.com"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Payout Email"}
            </button>

            {hasSavedEmail && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Ready for payouts
              </span>
            )}
          </div>
        </form>

        {message && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
              message.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {message.type === "error" && (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{message.text}</span>
          </div>
        )}
      </section>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-medium">Important</p>
        <p className="mt-1 text-amber-800">
          PayPal may require you to accept or claim the payout if your account is new
          or if the email is not confirmed on your PayPal account.
        </p>
      </div>
    </div>
  );
}

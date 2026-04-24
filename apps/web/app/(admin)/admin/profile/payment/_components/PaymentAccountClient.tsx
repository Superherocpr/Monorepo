"use client";

/**
 * PaymentAccountClient — interactive UI for the instructor payment account page.
 * Shows connected platform accounts, set-as-active, disconnect, and connect buttons.
 * Used by: app/(admin)/admin/profile/payment/page.tsx
 */

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, CheckCircle, AlertTriangle } from "lucide-react";
import type { ConnectedAccount } from "../page";
import type { PaymentPlatform } from "@/types/users";

interface PaymentAccountClientProps {
  instructorId: string;
  initialAccounts: ConnectedAccount[];
  /** Platform name if we just returned from a successful OAuth callback (e.g. "paypal"). */
  connectedParam: string | null;
}

/** Human-readable platform label. */
const PLATFORM_LABELS: Record<PaymentPlatform, string> = {
  paypal: "PayPal",
  square: "Square",
  stripe: "Stripe",
  venmo_business: "Venmo Business",
};

/**
 * Returns the OAuth initiate URL for a given platform.
 * The instructor_id is passed so the API can sanity-check
 * (the session is the authoritative source on the server side).
 * @param platform - The payment platform.
 * @param instructorId - The current instructor's profile ID.
 */
function oauthUrl(platform: PaymentPlatform, instructorId: string): string {
  return `/api/payments/oauth/${platform === "venmo_business" ? "venmo" : platform}?instructor_id=${instructorId}`;
}

/**
 * Returns a Tailwind background class for the platform card accent.
 * @param platform - The payment platform.
 */
function platformColor(platform: PaymentPlatform): string {
  const map: Record<PaymentPlatform, string> = {
    paypal: "bg-blue-50 border-blue-200",
    square: "bg-gray-50 border-gray-300",
    stripe: "bg-purple-50 border-purple-200",
    venmo_business: "bg-sky-50 border-sky-200",
  };
  return map[platform];
}

/**
 * Formats a connected_at timestamp into a human-readable string.
 * @param iso - ISO 8601 date string.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** All four supported platforms in display order. */
const ALL_PLATFORMS: PaymentPlatform[] = ["paypal", "square", "stripe", "venmo_business"];

/**
 * Root client component for the instructor payment account page.
 * Manages local account state, toast messages, and disconnect confirmation UI.
 */
const PaymentAccountClient: React.FC<PaymentAccountClientProps> = ({
  instructorId,
  initialAccounts,
  connectedParam,
}) => {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>(initialAccounts);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [settingActiveId, setSettingActiveId] = useState<string | null>(null);
  const [disconnectConfirmId, setDisconnectConfirmId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Shows a toast notification and auto-dismisses after 4 seconds on success.
   * Error toasts persist until dismissed.
   * @param message - The message to display.
   * @param type - "success" or "error".
   */
  function showToast(message: string, type: "success" | "error") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    if (type === "success") {
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    }
  }

  // Show success banner if we just returned from OAuth callback
  useEffect(() => {
    if (connectedParam) {
      const label =
        PLATFORM_LABELS[connectedParam as PaymentPlatform] ?? connectedParam;
      showToast(`${label} connected successfully.`, "success");
      // Clean the query param without triggering a full navigation
      window.history.replaceState(null, "", "/admin/profile/payment");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sets a payment account as the active one for invoicing.
   * Sends PATCH /api/payments/set-active.
   * @param accountId - ID of the account to make active.
   */
  async function handleSetActive(accountId: string) {
    setSettingActiveId(accountId);
    try {
      const res = await fetch("/api/payments/set-active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error ?? "Failed to update active account.", "error");
      } else {
        // Move the active badge locally
        setAccounts((prev) =>
          prev.map((a) => ({ ...a, is_active: a.id === accountId }))
        );
        showToast("Active payment account updated.", "success");
      }
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setSettingActiveId(null);
    }
  }

  /**
   * Disconnects a payment account after inline confirmation.
   * Sends DELETE /api/payments/[id]/disconnect.
   * If the disconnected account was active and others exist, the server
   * auto-promotes the most recently connected remaining account.
   * @param account - The account to disconnect.
   */
  async function handleDisconnect(account: ConnectedAccount) {
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/payments/${account.id}/disconnect`, {
        method: "DELETE",
      });
      const data: {
        success: boolean;
        error?: string;
        newActiveId?: string;
      } = await res.json();

      if (!res.ok || !data.success) {
        showToast(data.error ?? "Failed to disconnect account.", "error");
      } else {
        let updated = accounts.filter((a) => a.id !== account.id);
        // If server promoted a new active account, apply it locally
        if (data.newActiveId) {
          updated = updated.map((a) => ({
            ...a,
            is_active: a.id === data.newActiveId,
          }));
        }
        setAccounts(updated);
        setDisconnectConfirmId(null);
        showToast(
          `${PLATFORM_LABELS[account.platform]} disconnected.`,
          "success"
        );
        router.refresh();
      }
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setDisconnecting(false);
    }
  }

  const connectedPlatforms = new Set(accounts.map((a) => a.platform));
  const unconnectedPlatforms = ALL_PLATFORMS.filter(
    (p) => !connectedPlatforms.has(p)
  );

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payment Account</h1>
        <p className="mt-1 text-sm text-gray-600 max-w-xl">
          Connect the payment account you use to receive invoice payments from
          your students. This is personal to you — invoices you send will direct
          students to pay you directly.
        </p>
      </div>

      {/* ── Connected accounts ───────────────────────────────────────────────── */}
      {accounts.length > 0 ? (
        <section aria-label="Connected payment accounts">
          {/* Active account note */}
          <p className="text-sm text-gray-600 mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            Your active account is used when sending new invoices. Changing your
            active account does not affect invoices already sent.
          </p>

          <div className="space-y-4">
            {accounts.map((account) => {
              const label = PLATFORM_LABELS[account.platform];
              const isConfirming = disconnectConfirmId === account.id;

              return (
                <div
                  key={account.id}
                  className={`border rounded-lg p-4 ${platformColor(account.platform)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Platform + active badge */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">
                          {label}
                        </span>
                        {account.is_active && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-800 bg-green-100 px-2 py-0.5 rounded-full">
                            <CheckCircle className="h-3 w-3" aria-hidden="true" />
                            Active
                          </span>
                        )}
                      </div>

                      {/* Account identifier */}
                      {account.platform_account_id && (
                        <p className="text-sm text-gray-700 mt-0.5">
                          {label}: {account.platform_account_id}
                        </p>
                      )}

                      {/* Connected date */}
                      <p className="text-xs text-gray-500 mt-0.5">
                        Connected {formatDate(account.connected_at)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {!account.is_active && (
                        <button
                          onClick={() => handleSetActive(account.id)}
                          disabled={settingActiveId !== null}
                          aria-label={`Set ${label} as active payment account`}
                          className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50 transition-colors"
                        >
                          {settingActiveId === account.id
                            ? "Updating…"
                            : "Set as Active"}
                        </button>
                      )}

                      {/* Reconnect — useful if token expired */}
                      <a
                        href={oauthUrl(account.platform, instructorId)}
                        className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                        aria-label={`Reconnect ${label} account`}
                      >
                        Reconnect
                      </a>
                    </div>
                  </div>

                  {/* Disconnect — inline confirmation */}
                  {!isConfirming ? (
                    <div className="mt-3 pt-3 border-t border-gray-200/70">
                      <button
                        onClick={() => setDisconnectConfirmId(account.id)}
                        className="text-xs text-red-600 hover:text-red-800 font-medium transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-gray-200/70">
                      <p className="text-xs text-gray-700 mb-2">
                        Disconnect {label}? You can reconnect at any time.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDisconnectConfirmId(null)}
                          disabled={disconnecting}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDisconnect(account)}
                          disabled={disconnecting}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
                        >
                          {disconnecting ? "Disconnecting…" : "Disconnect"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        /* ── Empty state ──────────────────────────────────────────────────── */
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <CreditCard
            className="mx-auto text-gray-400 mb-3"
            style={{ width: 48, height: 48 }}
            aria-hidden="true"
          />
          <h2 className="text-base font-semibold text-gray-900">
            No payment account connected
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Connect a payment account to start sending invoices to your students.
          </p>
        </div>
      )}

      {/* ── Connect new accounts ─────────────────────────────────────────────── */}
      {unconnectedPlatforms.length > 0 && (
        <section aria-label="Connect a payment platform">
          <h2 className="text-base font-semibold text-gray-900 mb-3">
            Connect a Platform
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unconnectedPlatforms.map((platform) => {
              const label = PLATFORM_LABELS[platform];
              return (
                <a
                  key={platform}
                  href={oauthUrl(platform, instructorId)}
                  aria-label={`Connect ${label} account`}
                  className="flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <CreditCard className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  + Connect {label}
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Invoice impact notice ─────────────────────────────────────────────── */}
      <div className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <p className="font-medium text-amber-900 mb-1">Important</p>
        <p>
          Changing your active payment account affects new invoices only.
          Invoices you&apos;ve already sent will still use the payment link from
          when they were created. If a recipient has an unpaid invoice on the old
          platform, they should still pay it there.
        </p>
      </div>

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 max-w-sm w-full rounded-lg shadow-lg p-4 flex items-start gap-3 ${
            toast.type === "success"
              ? "bg-green-50 border border-green-200"
              : "bg-red-50 border border-red-200"
          }`}
        >
          {toast.type === "error" && (
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <p
            className={`text-sm font-medium ${
              toast.type === "success" ? "text-green-800" : "text-red-800"
            }`}
          >
            {toast.message}
          </p>
          {toast.type === "error" && (
            <button
              onClick={() => setToast(null)}
              className="ml-auto text-red-500 hover:text-red-700 text-lg leading-none"
              aria-label="Dismiss error"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default PaymentAccountClient;

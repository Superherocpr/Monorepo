"use client";

/**
 * ArchivedClient — interactive list of archived customer accounts.
 * Handles client-side search filtering and inline restore confirmation.
 * Used by: app/(admin)/admin/archived/page.tsx
 */

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Search } from "lucide-react";
import type { ArchivedCustomer } from "../page";

interface ArchivedClientProps {
  customers: ArchivedCustomer[];
}

/**
 * Formats a date string into a human-readable month + year.
 * @param iso - ISO 8601 date string.
 */
function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });
}

/**
 * Formats a date string into a human-readable full date.
 * @param iso - ISO 8601 date string, or null.
 */
function formatDate(iso: string | null): string {
  if (!iso) return "Unknown";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Interactive client component for the Archived Accounts page.
 * Filters customers client-side and manages inline restore confirmation + toasts.
 */
const ArchivedClient: React.FC<ArchivedClientProps> = ({ customers: initial }) => {
  const router = useRouter();
  const [customers, setCustomers] = useState<ArchivedCustomer[]>(initial);
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Shows a toast notification. Success toasts auto-dismiss after 4 seconds.
   * @param message - Text to display.
   * @param type - "success" or "error".
   */
  function showToast(message: string, type: "success" | "error") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    if (type === "success") {
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    }
  }

  // Client-side search: match on first_name, last_name, or email
  const query = search.trim().toLowerCase();
  const filtered = query
    ? customers.filter(
        (c) =>
          c.first_name.toLowerCase().includes(query) ||
          c.last_name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query)
      )
    : customers;

  /**
   * Restores a customer account by calling POST /api/customers/restore.
   * On success, removes the customer from local state immediately.
   * @param customer - The archived customer to restore.
   */
  async function handleRestore(customer: ArchivedCustomer) {
    setRestoring(true);
    try {
      const res = await fetch("/api/customers/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id }),
      });
      const data: { success: boolean; error?: string } = await res.json();

      if (!res.ok || !data.success) {
        showToast(data.error ?? "Failed to restore account.", "error");
      } else {
        // Remove immediately from local state
        setCustomers((prev) => prev.filter((c) => c.id !== customer.id));
        setConfirmId(null);
        showToast(
          `Account restored. ${customer.first_name} ${customer.last_name} can now log in again.`,
          "success"
        );
        router.refresh();
      }
    } catch {
      showToast("Something went wrong. Please try again.", "error");
    } finally {
      setRestoring(false);
    }
  }

  const n = customers.length;

  return (
    <div className="space-y-6">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Archived Accounts</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-xl">
            These customer accounts have been archived. All data is preserved. You
            can restore access at any time.
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
          {n} archived account{n !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Search bar ───────────────────────────────────────────────────────── */}
      <div className="relative max-w-sm">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {customers.length === 0 ? (
        /* Empty state — no archived accounts at all */
        <div className="text-center py-16 border border-gray-200 rounded-lg bg-white">
          <CheckCircle2
            className="mx-auto text-green-500 mb-3"
            style={{ width: 48, height: 48 }}
            aria-hidden="true"
          />
          <h2 className="text-base font-semibold text-gray-900">
            No archived accounts
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            All customer accounts are currently active.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        /* No search results */
        <p className="text-sm text-gray-500 py-8 text-center">
          No archived accounts match your search.
        </p>
      ) : (
        <>
          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="hidden md:block bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Archived
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Data
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filtered.map((customer) => {
                  const isConfirming = confirmId === customer.id;
                  const fullName = `${customer.first_name} ${customer.last_name}`;
                  return (
                    <tr key={customer.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-gray-900">{fullName}</p>
                        <p className="text-xs text-gray-500">{customer.email}</p>
                        {customer.phone && (
                          <p className="text-xs text-gray-400">{customer.phone}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">
                          Customer since {formatMonthYear(customer.created_at)}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs text-red-500 font-medium">
                          Archived {formatDate(customer.archived_at)}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs text-gray-500">
                          {customer.bookingCount} booking{customer.bookingCount !== 1 ? "s" : ""} ·{" "}
                          {customer.certCount} cert{customer.certCount !== 1 ? "s" : ""} ·{" "}
                          {customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {isConfirming ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <p className="text-xs text-gray-700 text-right">
                              Restore access for {customer.first_name}?<br />
                              They will be able to log in again.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setConfirmId(null)}
                                disabled={restoring}
                                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleRestore(customer)}
                                disabled={restoring}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
                              >
                                {restoring ? "Restoring…" : "Restore Account"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(customer.id)}
                            className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ───────────────────────────────────────────────── */}
          <div className="md:hidden space-y-4">
            {filtered.map((customer) => {
              const isConfirming = confirmId === customer.id;
              const fullName = `${customer.first_name} ${customer.last_name}`;
              return (
                <div
                  key={customer.id}
                  className="bg-white border border-gray-200 rounded-lg shadow-sm p-4"
                >
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{fullName}</p>
                      <p className="text-xs text-gray-500 truncate">{customer.email}</p>
                      {customer.phone && (
                        <p className="text-xs text-gray-400">{customer.phone}</p>
                      )}
                    </div>
                    <p className="text-xs text-red-500 font-medium shrink-0">
                      Archived {formatDate(customer.archived_at)}
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <p className="text-xs text-gray-400">
                      Customer since {formatMonthYear(customer.created_at)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {customer.bookingCount} booking{customer.bookingCount !== 1 ? "s" : ""} ·{" "}
                      {customer.certCount} cert{customer.certCount !== 1 ? "s" : ""} ·{" "}
                      {customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""}
                    </p>
                  </div>

                  <div className="mt-3 pt-3 border-t border-gray-100">
                    {isConfirming ? (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-700">
                          Restore access for {customer.first_name}? They will be able to
                          log in again.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmId(null)}
                            disabled={restoring}
                            className="flex-1 px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRestore(customer)}
                            disabled={restoring}
                            className="flex-1 px-3 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
                          >
                            {restoring ? "Restoring…" : "Restore Account"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(customer.id)}
                        className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

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
            <AlertTriangle
              className="h-5 w-5 text-red-500 shrink-0 mt-0.5"
              aria-hidden="true"
            />
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

export default ArchivedClient;

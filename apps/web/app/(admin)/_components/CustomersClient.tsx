/**
 * CustomersClient — client component for the admin customer management page.
 * Used by: app/(admin)/admin/customers/page.tsx
 *
 * Owns search state (debounced, server-side), filter state, and the
 * create-customer slide-in panel. Displays customers in a table (desktop)
 * or card list (mobile).
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Search, X, UserPlus, CheckCircle2 } from "lucide-react";
import type { UserRole } from "@/types/users";

// ── Types ────────────────────────────────────────────────────────────────────

/** A customer profile decorated with pre-computed booking and cert counts. */
export interface CustomerWithMeta {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  archived: boolean;
  upcomingBookingsCount: number;
  totalBookingsCount: number;
  activeCertsCount: number;
  hasExpiringSoon: boolean;
}

interface CustomersClientProps {
  initialCustomers: CustomerWithMeta[];
  userRole: UserRole;
}

// ── Filter types ─────────────────────────────────────────────────────────────

type CertFilter = "all" | "active" | "expiring" | "expired";
type BookingFilter = "all" | "upcoming" | "past" | "none";
type StatusFilter = "all" | "active" | "archived";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives the cert status label and color class for a customer row.
 * Priority: expiring > active > expired > none.
 * @param activeCertsCount - Number of non-expired certs.
 * @param hasExpiringSoon - Whether any cert expires within 90 days.
 * @param totalCertsCount - Total certs count (not used — inferred by activeCertsCount === 0 check).
 */
function certBadge(
  activeCertsCount: number,
  hasExpiringSoon: boolean
): { label: string; className: string } {
  if (activeCertsCount === 0) {
    return { label: "No Certs", className: "bg-gray-100 text-gray-600" };
  }
  if (hasExpiringSoon) {
    return { label: "Expiring Soon", className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Certified", className: "bg-green-100 text-green-700" };
}

/**
 * Formats a UTC ISO date string as "Month YYYY" for the join date column.
 * @param iso - ISO date string from the database.
 */
function formatJoinDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Applies cert, booking, and status filters to a customer list entirely
 * client-side. These filters are applied after the server search returns data.
 * @param customers - The raw list to filter.
 * @param cert - Cert status filter selection.
 * @param booking - Booking activity filter selection.
 * @param status - Account status filter selection.
 */
function applyFilters(
  customers: CustomerWithMeta[],
  cert: CertFilter,
  booking: BookingFilter,
  status: StatusFilter
): CustomerWithMeta[] {
  return customers.filter((c) => {
    // Cert filter
    if (cert === "active" && (c.activeCertsCount === 0 || c.hasExpiringSoon))
      return false;
    if (cert === "expiring" && !c.hasExpiringSoon) return false;
    if (cert === "expired" && c.activeCertsCount > 0) return false;

    // Booking filter
    if (booking === "upcoming" && c.upcomingBookingsCount === 0) return false;
    if (booking === "past" && c.totalBookingsCount === 0) return false;
    if (booking === "none" && c.totalBookingsCount > 0) return false;

    // Status filter
    if (status === "active" && c.archived) return false;
    if (status === "archived" && !c.archived) return false;

    return true;
  });
}

// ── Main component ────────────────────────────────────────────────────────────

/** Customer management page client component. Handles search, filters, and creation. */
export default function CustomersClient({
  initialCustomers,
  userRole,
}: CustomersClientProps) {
  // ── Search state ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [customers, setCustomers] =
    useState<CustomerWithMeta[]>(initialCustomers);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Filter state ────────────────────────────────────────────────────────────
  const [certFilter, setCertFilter] = useState<CertFilter>("all");
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ── Create panel state ──────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const firstNameRef = useRef<HTMLInputElement>(null);

  // ── Derived list ────────────────────────────────────────────────────────────
  const filtered = applyFilters(customers, certFilter, bookingFilter, statusFilter);

  // ── Search — debounced 300ms ─────────────────────────────────────────────────
  /**
   * Fires a fetch to /api/customers/search after 300ms of no typing.
   * Resets to initial customers when the query is cleared.
   */
  const fetchSearch = useCallback(
    async (term: string, cert: CertFilter, booking: BookingFilter) => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({ q: term, cert, booking });
        const res = await fetch(`/api/customers/search?${params}`);
        if (!res.ok) throw new Error("Search failed");
        const json = await res.json();
        setCustomers(json.customers ?? []);
      } catch {
        // Network error — keep showing the last known list
      } finally {
        setIsSearching(false);
      }
    },
    []
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length === 0) {
      // Restore initial list when search is cleared
      setCustomers(initialCustomers);
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetchSearch(query, certFilter, bookingFilter);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, certFilter, bookingFilter, fetchSearch, initialCustomers]);

  // Focus first name input when panel opens
  useEffect(() => {
    if (panelOpen) {
      setTimeout(() => firstNameRef.current?.focus(), 50);
    }
  }, [panelOpen]);

  // Auto-dismiss success toast after 4 seconds
  useEffect(() => {
    if (!successToast) return;
    const t = setTimeout(() => setSuccessToast(null), 4000);
    return () => clearTimeout(t);
  }, [successToast]);

  // ── Create customer ──────────────────────────────────────────────────────────
  /**
   * Submits the new customer form. Sends a POST to /api/customers/create,
   * handles the duplicate-email 409, and refreshes the customer list on success.
   */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    try {
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email: newEmail, phone }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        setCreateError(json.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Success — close panel, reset form, refresh list, show toast
      setPanelOpen(false);
      setFirstName("");
      setLastName("");
      setNewEmail("");
      setPhone("");
      setSuccessToast(`Account created. Setup email sent to ${newEmail}.`);

      // Refresh the customer list from the server
      fetchSearch(query, certFilter, bookingFilter);
    } catch {
      setCreateError("Network error. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  /**
   * Closes the create panel and resets all form state.
   */
  function closePanel() {
    setPanelOpen(false);
    setFirstName("");
    setLastName("");
    setNewEmail("");
    setPhone("");
    setCreateError(null);
  }

  // ── Pill button helper ───────────────────────────────────────────────────────
  /**
   * Returns the class string for a filter pill button.
   * @param active - Whether this pill is the currently selected filter.
   */
  function pillClass(active: boolean): string {
    return active
      ? "rounded-full px-3 py-1 text-xs font-semibold bg-red-600 text-white"
      : "rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200";
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* ── Success toast ─────────────────────────────────────────────────────── */}
      {successToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successToast}
        </div>
      )}

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">
            All customer accounts — active and archived.
          </p>
        </div>
        {/* Managers and super admins can create new customers */}
        {(userRole === "manager" || userRole === "super_admin") && (
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <UserPlus className="h-4 w-4" />
            New Customer
          </button>
        )}
      </div>

      {/* ── Search bar ────────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          aria-label="Search customers"
          placeholder="Search by name, email, or phone..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isSearching && (
        <p aria-live="polite" className="mb-3 text-xs text-gray-400">
          Searching...
        </p>
      )}

      {/* ── Filter bar ────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-4">
        {/* Cert status */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">Cert:</span>
          {(
            [
              { value: "all", label: "All" },
              { value: "active", label: "Has active cert" },
              { value: "expiring", label: "Expiring within 90 days" },
              { value: "expired", label: "Expired / no cert" },
            ] as { value: CertFilter; label: string }[]
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setCertFilter(value)}
              aria-pressed={certFilter === value}
              className={pillClass(certFilter === value)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Booking activity */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">Bookings:</span>
          {(
            [
              { value: "all", label: "All" },
              { value: "upcoming", label: "Has upcoming class" },
              { value: "past", label: "Has past classes" },
              { value: "none", label: "No bookings" },
            ] as { value: BookingFilter; label: string }[]
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setBookingFilter(value)}
              aria-pressed={bookingFilter === value}
              className={pillClass(bookingFilter === value)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Account status */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">Status:</span>
          {(
            [
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ] as { value: StatusFilter; label: string }[]
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
              className={pillClass(statusFilter === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Customer list ─────────────────────────────────────────────────────── */}
      <div aria-live="polite">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
            <p className="text-gray-500">
              {query
                ? `No customers found matching "${query}".`
                : "No customers yet."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-lg border border-gray-200 md:block">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Name
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Contact
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Joined
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Bookings
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Certs
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filtered.map((customer) => {
                    const cert = certBadge(
                      customer.activeCertsCount,
                      customer.hasExpiringSoon
                    );
                    return (
                      <tr
                        key={customer.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() =>
                          (window.location.href = `/admin/customers/${customer.id}`)
                        }
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/customers/${customer.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-gray-900 hover:text-red-600"
                          >
                            {customer.first_name} {customer.last_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-600">{customer.email}</p>
                          {customer.phone && (
                            <p className="text-xs text-gray-400">{customer.phone}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          Joined {formatJoinDate(customer.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">
                              {customer.totalBookingsCount}{" "}
                              {customer.totalBookingsCount !== 1
                                ? "bookings"
                                : "booking"}
                            </span>
                            {customer.upcomingBookingsCount > 0 && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                Upcoming
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cert.className}`}
                          >
                            {cert.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {customer.archived ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                              Archived
                            </span>
                          ) : (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Active
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <ul className="space-y-3 md:hidden">
              {filtered.map((customer) => {
                const cert = certBadge(
                  customer.activeCertsCount,
                  customer.hasExpiringSoon
                );
                return (
                  <li key={customer.id}>
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-red-300 hover:bg-red-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {customer.first_name} {customer.last_name}
                          </p>
                          <p className="mt-0.5 text-sm text-gray-500">
                            {customer.email}
                          </p>
                          {customer.phone && (
                            <p className="text-xs text-gray-400">
                              {customer.phone}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {customer.archived ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                              Archived
                            </span>
                          ) : (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Active
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cert.className}`}
                          >
                            {cert.label}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                        <span>
                          {customer.totalBookingsCount}{" "}
                          {customer.totalBookingsCount !== 1
                            ? "bookings"
                            : "booking"}
                        </span>
                        {customer.upcomingBookingsCount > 0 && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">
                            Upcoming
                          </span>
                        )}
                        <span>Joined {formatJoinDate(customer.created_at)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* ── Create customer slide-in panel ────────────────────────────────────── */}
      {panelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={closePanel}
            aria-hidden="true"
          />
          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create new customer"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                New Customer
              </h2>
              <button
                onClick={closePanel}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close panel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Panel body */}
            <form
              onSubmit={handleCreate}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6"
            >
              <div>
                <label
                  htmlFor="firstName"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  First name <span className="text-red-600">*</span>
                </label>
                <input
                  ref={firstNameRef}
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div>
                <label
                  htmlFor="lastName"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Last name <span className="text-red-600">*</span>
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div>
                <label
                  htmlFor="newEmail"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Email <span className="text-red-600">*</span>
                </label>
                <input
                  id="newEmail"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div>
                <label
                  htmlFor="phone"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Phone{" "}
                  <span className="text-xs text-gray-400">(optional)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              {createError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {createError}
                </p>
              )}

              <div className="mt-auto pt-4">
                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating
                    ? "Creating..."
                    : "Create Account & Send Setup Email"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

/**
 * OrdersAdminClient — client component for the admin orders page.
 * Handles filter navigation, expandable order rows, mark-as-shipped,
 * mark-as-delivered, cancel/refund, and auto-saving internal notes.
 * Used by: app/(admin)/admin/orders/page.tsx
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Package,
  Truck,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { AdminOrderRecord } from "@/types/orders";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Active filter values resolved from URL search params. */
interface ActiveFilters {
  status: string | null;
  from: string | null;
  to: string | null;
  customer: string | null;
}

/** All data passed from the server component. */
export interface OrdersPageData {
  orders: AdminOrderRecord[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  filters: ActiveFilters;
}

/** State of the inline shipping form for a single order. */
interface ShippingFormState {
  orderId: string;
  tracking: string;
  carrier: string;
}

/** State of the inline cancel/refund form for a single order. */
interface CancelFormState {
  orderId: string;
  amount: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a numeric amount as USD.
 * @param amount - Numeric dollar amount.
 */
function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

/**
 * Formats an ISO date string as "Apr 14, 2026".
 * @param iso - ISO date string.
 */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns Tailwind badge classes for a given order status.
 * @param status - Order status enum value.
 */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "paid":
      return "bg-blue-100 text-blue-800";
    case "shipped":
      return "bg-purple-100 text-purple-800";
    case "delivered":
      return "bg-green-100 text-green-800";
    case "cancelled":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/**
 * Returns the display label for a given order status.
 * @param status - Order status enum value.
 */
function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

/**
 * Builds a URL for the orders page with updated search params.
 * Preserves existing params and overrides only specified ones.
 * @param base - Current filter state.
 * @param overrides - Params to change (null removes the param).
 * @param resetPage - Whether to reset page back to 1.
 */
function buildUrl(
  base: ActiveFilters & { page?: number },
  overrides: Partial<ActiveFilters & { page: number | null }>,
  resetPage = true
): string {
  const merged = { ...base, ...overrides };
  if (resetPage) merged.page = 1;

  const params = new URLSearchParams();
  if (merged.status) params.set("status", merged.status);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.customer) params.set("customer", merged.customer);
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));

  const qs = params.toString();
  return `/admin/orders${qs ? `?${qs}` : ""}`;
}

/**
 * Returns a one-line summary of items in an order, e.g. "CPR T-Shirt (M), Keychain (One Size)".
 * @param items - The order_items array from the order.
 */
function itemsSummary(items: AdminOrderRecord["order_items"]): string {
  return items
    .map((item) => {
      const pv = item.product_variants;
      return `${pv.products.name} (${pv.size})${item.quantity > 1 ? ` ×${item.quantity}` : ""}`;
    })
    .join(", ");
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Full admin orders page: filter bar, order list, inline detail panels, and mutations.
 */
export default function OrdersAdminClient({ data }: { data: OrdersPageData }) {
  const { totalCount, totalPages, currentPage, filters } = data;
  const router = useRouter();

  // ── Local order state (updated optimistically on mutation) ─────────────────
  const [orders, setOrders] = useState<AdminOrderRecord[]>(data.orders);

  // ── Panel/form state ───────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shippingForm, setShippingForm] = useState<ShippingFormState | null>(null);
  const [cancelForm, setCancelForm] = useState<CancelFormState | null>(null);

  // ── Action state ───────────────────────────────────────────────────────────
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Notes state ───────────────────────────────────────────────────────────
  const [notesMap, setNotesMap] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    data.orders.forEach((o) => {
      map[o.id] = o.notes ?? "";
    });
    return map;
  });
  const [notesSavingId, setNotesSavingId] = useState<string | null>(null);

  // ── Filter state ───────────────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch] = useState(filters.customer ?? "");
  const customerSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters =
    !!filters.status || !!filters.from || !!filters.to || !!filters.customer;

  // ── Filter navigation helpers ──────────────────────────────────────────────

  /** Navigates to orders page with updated status filter. */
  function handleStatusFilter(status: string | null) {
    router.push(buildUrl(filters, { status }));
  }

  /** Navigates to orders page with updated date range filter. */
  function handleDateFilter(field: "from" | "to", value: string) {
    router.push(buildUrl(filters, { [field]: value || null }));
  }

  /** Debounced customer search — navigates after 400ms of inactivity. */
  function handleCustomerSearchChange(value: string) {
    setCustomerSearch(value);
    if (customerSearchTimeout.current) clearTimeout(customerSearchTimeout.current);
    customerSearchTimeout.current = setTimeout(() => {
      router.push(buildUrl(filters, { customer: value.trim() || null }));
    }, 400);
  }

  // ── Mutation handlers ──────────────────────────────────────────────────────

  /**
   * Calls mark-shipped API, updates local order state on success.
   * @param form - Current shipping form state containing orderId, tracking, carrier.
   */
  async function handleMarkShipped(form: ShippingFormState) {
    setActionError(null);
    setSavingId(form.orderId);
    try {
      const res = await fetch("/api/orders/mark-shipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: form.orderId,
          trackingNumber: form.tracking,
          carrier: form.carrier || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error ?? "Failed to mark order as shipped.");
        return;
      }
      // Update local state
      setOrders((prev) =>
        prev.map((o) =>
          o.id === form.orderId
            ? { ...o, status: "shipped", tracking_number: form.tracking }
            : o
        )
      );
      setShippingForm(null);
    } catch {
      setActionError("An unexpected error occurred.");
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Calls mark-delivered API, updates local order state on success.
   * @param orderId - The order to mark as delivered.
   */
  async function handleMarkDelivered(orderId: string) {
    setActionError(null);
    setSavingId(orderId);
    try {
      const res = await fetch("/api/orders/mark-delivered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error ?? "Failed to mark order as delivered.");
        return;
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: "delivered" } : o))
      );
    } catch {
      setActionError("An unexpected error occurred.");
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Calls cancel-refund API with the provided refund amount.
   * Updates local state only if the API reports success.
   * @param form - Current cancel form state with orderId and amount string.
   */
  async function handleCancelRefund(form: CancelFormState) {
    setActionError(null);
    const refundAmount = parseFloat(form.amount);
    if (isNaN(refundAmount) || refundAmount <= 0) {
      setActionError("Please enter a valid refund amount.");
      return;
    }
    setSavingId(form.orderId);
    try {
      const res = await fetch("/api/orders/cancel-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: form.orderId, refundAmount }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error ?? "Cancellation failed.");
        return;
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === form.orderId
            ? { ...o, status: "cancelled", notes: data.note ?? o.notes }
            : o
        )
      );
      setCancelForm(null);
    } catch {
      setActionError("An unexpected error occurred.");
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Auto-saves notes for an order on blur — PATCH to update-notes.
   * @param orderId - ID of the order whose notes changed.
   */
  async function handleNotesSave(orderId: string) {
    const notes = notesMap[orderId] ?? "";
    setNotesSavingId(orderId);
    try {
      await fetch("/api/orders/update-notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, notes }),
      });
    } catch {
      // Silent — notes auto-save is best-effort
    } finally {
      setNotesSavingId(null);
    }
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  const startItem = (currentPage - 1) * 50 + 1;
  const endItem = Math.min(currentPage * 50, totalCount);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="mt-1 text-sm text-gray-500">
            {totalCount === 0
              ? "No orders yet."
              : `${totalCount} order${totalCount !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        {/* Status pills */}
        <div className="flex flex-wrap gap-2">
          {(["all", "pending", "paid", "shipped", "delivered", "cancelled"] as const).map(
            (s) => {
              const active = s === "all" ? !filters.status : filters.status === s;
              return (
                <button
                  key={s}
                  onClick={() => handleStatusFilter(s === "all" ? null : s)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    active
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s === "all" ? "All" : statusLabel(s)}
                </button>
              );
            }
          )}
        </div>

        {/* Date range + customer search */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => handleDateFilter("from", e.target.value)}
              className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => handleDateFilter("to", e.target.value)}
              className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search customer…"
              value={customerSearch}
              onChange={(e) => handleCustomerSearchChange(e.target.value)}
              className="rounded border border-gray-200 py-1 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
            />
            {customerSearch && (
              <button
                onClick={() => {
                  setCustomerSearch("");
                  router.push(buildUrl(filters, { customer: null }));
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear customer search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {hasFilters && (
            <Link
              href="/admin/orders"
              className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Link>
          )}
        </div>
      </div>

      {/* ── Global action error ───────────────────────────────────────────── */}
      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="ml-auto shrink-0 text-red-400 hover:text-red-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Orders list ──────────────────────────────────────────────────── */}
      {orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white py-16 text-center">
          <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="font-medium text-gray-500">
            {hasFilters ? "No orders found matching your filters." : "No orders yet."}
          </p>
          {hasFilters && (
            <Link href="/admin/orders" className="mt-2 text-sm text-red-600 hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {/* Desktop table header */}
          <div className="hidden grid-cols-[1fr_1fr_2fr_auto_auto_auto] gap-4 border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 md:grid">
            <span>Date</span>
            <span>Customer</span>
            <span>Items</span>
            <span className="text-right">Total</span>
            <span>Status</span>
            <span />
          </div>

          {orders.map((order) => {
            const isExpanded = expandedId === order.id;
            const isSaving = savingId === order.id;
            const isShippingOpen = shippingForm?.orderId === order.id;
            const isCancelOpen = cancelForm?.orderId === order.id;
            const itemCount = order.order_items.length;

            return (
              <div key={order.id} className="border-b border-gray-100 last:border-0">
                {/* ── Row ── */}
                <div
                  className="grid grid-cols-1 gap-y-1 px-4 py-3 md:grid-cols-[1fr_1fr_2fr_auto_auto_auto] md:items-center md:gap-4"
                  role="row"
                >
                  {/* Date */}
                  <span className="text-sm text-gray-700">{fmtDate(order.created_at)}</span>

                  {/* Customer */}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {order.profiles.first_name} {order.profiles.last_name}
                    </p>
                    <p className="truncate text-xs text-gray-400">{order.profiles.email}</p>
                  </div>

                  {/* Items summary */}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500">
                      {itemCount} item{itemCount !== 1 ? "s" : ""}
                    </p>
                    <p className="truncate text-xs text-gray-400">{itemsSummary(order.order_items)}</p>
                  </div>

                  {/* Total */}
                  <span className="text-sm font-semibold text-gray-900 md:text-right">
                    {fmtCurrency(order.total_amount)}
                  </span>

                  {/* Status + tracking */}
                  <div className="flex flex-col gap-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(order.status)}`}
                    >
                      {statusLabel(order.status)}
                    </span>
                    {order.tracking_number && (
                      <span className="text-xs text-gray-400">
                        Tracking: {order.tracking_number}
                      </span>
                    )}
                  </div>

                  {/* Expand toggle */}
                  <button
                    onClick={() => {
                      setExpandedId(isExpanded ? null : order.id);
                      setActionError(null);
                    }}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? "Collapse order detail" : "Expand order detail"}
                    className="ml-auto flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 md:ml-0"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {/* ── Expanded detail ── */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-5">
                    {/* Shipping address */}
                    <div>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Shipping address
                      </h3>
                      <p className="text-sm text-gray-700">{order.shipping_name}</p>
                      <p className="text-sm text-gray-700">{order.shipping_address}</p>
                      <p className="text-sm text-gray-700">
                        {order.shipping_city}, {order.shipping_state} {order.shipping_zip}
                      </p>
                    </div>

                    {/* Line items */}
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Line items
                      </h3>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-xs font-semibold text-gray-500">
                            <th className="pb-1 pr-4">Product</th>
                            <th className="pb-1 pr-4">Size</th>
                            <th className="pb-1 pr-4 text-center">Qty</th>
                            <th className="pb-1 pr-4 text-right">Unit price</th>
                            <th className="pb-1 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.order_items.map((item) => {
                            const pv = item.product_variants;
                            return (
                              <tr key={item.id} className="border-b border-gray-100 last:border-0">
                                <td className="py-1.5 pr-4 text-gray-900">{pv.products.name}</td>
                                <td className="py-1.5 pr-4 text-gray-600">{pv.size}</td>
                                <td className="py-1.5 pr-4 text-center text-gray-600">
                                  {item.quantity}
                                </td>
                                <td className="py-1.5 pr-4 text-right text-gray-600">
                                  {fmtCurrency(item.price_at_purchase)}
                                </td>
                                <td className="py-1.5 text-right font-medium text-gray-900">
                                  {fmtCurrency(item.price_at_purchase * item.quantity)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="mt-2 text-right text-sm font-bold text-gray-900">
                        Order total: {fmtCurrency(order.total_amount)}
                      </div>
                    </div>

                    {/* PayPal transaction ID */}
                    {order.paypal_transaction_id && (
                      <div>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          PayPal transaction ID
                        </h3>
                        <p className="font-mono text-xs text-gray-700">
                          {order.paypal_transaction_id}
                        </p>
                      </div>
                    )}

                    {/* Internal notes */}
                    <div>
                      <label
                        htmlFor={`notes-${order.id}`}
                        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400"
                      >
                        Internal notes (not visible to customer)
                      </label>
                      <textarea
                        id={`notes-${order.id}`}
                        rows={2}
                        value={notesMap[order.id] ?? ""}
                        onChange={(e) =>
                          setNotesMap((prev) => ({ ...prev, [order.id]: e.target.value }))
                        }
                        onBlur={() => handleNotesSave(order.id)}
                        placeholder="Add fulfillment notes…"
                        className="w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
                      />
                      {notesSavingId === order.id && (
                        <p className="mt-0.5 text-xs text-gray-400">Saving…</p>
                      )}
                    </div>

                    {/* ── Action buttons ── */}
                    <div className="flex flex-wrap gap-2">
                      {/* Mark as Shipped */}
                      {order.status === "paid" && !isShippingOpen && !isCancelOpen && (
                        <button
                          onClick={() =>
                            setShippingForm({
                              orderId: order.id,
                              tracking: "",
                              carrier: "",
                            })
                          }
                          className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
                        >
                          <Truck className="h-3.5 w-3.5" />
                          Mark as Shipped
                        </button>
                      )}

                      {/* Mark as Delivered */}
                      {order.status === "shipped" && !isCancelOpen && (
                        <button
                          disabled={isSaving}
                          onClick={() => handleMarkDelivered(order.id)}
                          className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {isSaving ? "Saving…" : "Mark as Delivered"}
                        </button>
                      )}

                      {/* Cancel Order */}
                      {(order.status === "paid" ||
                        order.status === "shipped" ||
                        order.status === "delivered") &&
                        !isCancelOpen &&
                        !isShippingOpen && (
                          <button
                            onClick={() =>
                              setCancelForm({
                                orderId: order.id,
                                amount: String(order.total_amount),
                              })
                            }
                            className="flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Cancel Order
                          </button>
                        )}

                      {/* Cancelled message */}
                      {order.status === "cancelled" && (
                        <p className="text-sm text-gray-500">This order has been cancelled.</p>
                      )}
                    </div>

                    {/* ── Shipping form ── */}
                    {isShippingOpen && shippingForm && (
                      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3">
                        <h4 className="text-sm font-semibold text-purple-900">
                          Ship this order
                        </h4>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`tracking-${order.id}`}
                              className="mb-1 block text-xs font-medium text-gray-700"
                            >
                              Tracking number <span className="text-red-500">*</span>
                            </label>
                            <input
                              id={`tracking-${order.id}`}
                              type="text"
                              value={shippingForm.tracking}
                              onChange={(e) =>
                                setShippingForm((prev) =>
                                  prev ? { ...prev, tracking: e.target.value } : null
                                )
                              }
                              placeholder="e.g. 1Z999AA10123456784"
                              className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm focus:border-purple-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`carrier-${order.id}`}
                              className="mb-1 block text-xs font-medium text-gray-700"
                            >
                              Carrier (optional)
                            </label>
                            <input
                              id={`carrier-${order.id}`}
                              type="text"
                              value={shippingForm.carrier}
                              onChange={(e) =>
                                setShippingForm((prev) =>
                                  prev ? { ...prev, carrier: e.target.value } : null
                                )
                              }
                              placeholder="UPS, USPS, FedEx…"
                              className="w-full rounded border border-gray-200 px-3 py-1.5 text-sm focus:border-purple-400 focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShippingForm(null)}
                            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={!shippingForm.tracking.trim() || isSaving}
                            onClick={() => handleMarkShipped(shippingForm)}
                            className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            <Package className="h-3.5 w-3.5" />
                            {isSaving ? "Saving…" : "Mark Shipped & Send Email"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Cancel/refund form ── */}
                    {isCancelOpen && cancelForm && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                        <h4 className="text-sm font-semibold text-red-900">Cancel this order?</h4>
                        <p className="text-xs text-red-700">
                          This will issue a refund via PayPal. The PayPal refund must succeed
                          before the order is marked cancelled.
                        </p>
                        <div>
                          <label
                            htmlFor={`refund-${order.id}`}
                            className="mb-1 block text-xs font-medium text-gray-700"
                          >
                            Refund amount (max {fmtCurrency(order.total_amount)})
                          </label>
                          <div className="relative w-40">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                              $
                            </span>
                            <input
                              id={`refund-${order.id}`}
                              type="number"
                              min="0.01"
                              max={order.total_amount}
                              step="0.01"
                              aria-label="Refund amount in dollars"
                              value={cancelForm.amount}
                              onChange={(e) =>
                                setCancelForm((prev) =>
                                  prev ? { ...prev, amount: e.target.value } : null
                                )
                              }
                              className="w-full rounded border border-gray-200 py-1.5 pl-7 pr-3 text-sm focus:border-red-400 focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setCancelForm(null)}
                            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={isSaving}
                            onClick={() => handleCancelRefund(cancelForm)}
                            className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {isSaving ? "Processing…" : "Confirm Cancellation & Refund"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {startItem}–{endItem} of {totalCount} orders
          </span>
          <div className="flex items-center gap-2">
            {currentPage > 1 ? (
              <Link
                href={buildUrl({ ...filters, page: currentPage }, { page: currentPage - 1 }, false)}
                className="rounded border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                ← Previous
              </Link>
            ) : (
              <span className="rounded border border-gray-100 px-3 py-1.5 text-sm text-gray-300">
                ← Previous
              </span>
            )}
            <span className="text-sm text-gray-500">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link
                href={buildUrl({ ...filters, page: currentPage }, { page: currentPage + 1 }, false)}
                className="rounded border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded border border-gray-100 px-3 py-1.5 text-sm text-gray-300">
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

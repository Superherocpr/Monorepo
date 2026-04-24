/**
 * OrderCard — renders one merch order with four sections:
 *   1. Header: order date, order ID, status badge
 *   2. Items: product name, variant size, quantity, line total
 *   3. Summary: subtotal, shipping, order total
 *   4. Shipping/tracking (only if tracking_number is present)
 *
 * Used by: app/(public)/dashboard/orders/_components/OrdersList.tsx
 */

import { Package } from "lucide-react";
import type { OrderRecord } from "@/types/orders";

interface OrderCardProps {
  order: OrderRecord;
}

const statusStyles: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  paid: "bg-blue-100 text-blue-800",
  shipped: "bg-amber-100 text-amber-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Formats a monetary amount as a USD string: "$12.00". */
function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

/** Formats a date string to a short readable label: "April 1, 2024". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Renders a full order card with header, items, summary, and optional tracking. */
export default function OrderCard({ order }: OrderCardProps) {
  const statusStyle = statusStyles[order.status] ?? "bg-gray-100 text-gray-600";
  const statusLabel = statusLabels[order.status] ?? order.status;

  // Derive subtotal from line items; shipping is the difference to the total
  const subtotal = order.order_items.reduce(
    (sum, item) => sum + item.price_at_purchase * item.quantity,
    0
  );
  const shipping = order.total_amount - subtotal;

  return (
    <article className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* 1. Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
            Order
          </p>
          <p className="text-sm font-mono text-gray-600 mt-0.5">
            #{order.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDate(order.created_at)}
          </p>
        </div>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusStyle}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* 2. Items */}
      <div className="px-5 py-4 flex flex-col gap-3 border-b border-gray-100">
        {order.order_items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-md bg-gray-100 flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <Package size={16} className="text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {item.product_variants.products.name}
                </p>
                {item.product_variants.size && (
                  <p className="text-xs text-gray-500">
                    Size: {item.product_variants.size}
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  Qty: {item.quantity}
                </p>
              </div>
            </div>
            <p className="text-sm font-medium text-gray-800 shrink-0">
              {formatCurrency(item.price_at_purchase * item.quantity)}
            </p>
          </div>
        ))}
      </div>

      {/* 3. Summary */}
      <div className="px-5 py-4 flex flex-col gap-1.5 text-sm border-b border-gray-100">
        <div className="flex justify-between text-gray-500">
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between text-gray-500">
          <span>Shipping</span>
          <span>
            {shipping > 0 ? formatCurrency(shipping) : "Free"}
          </span>
        </div>
        <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-100 mt-1">
          <span>Total</span>
          <span>{formatCurrency(order.total_amount)}</span>
        </div>
      </div>

      {/* 4. Shipping / Tracking — only shown when a tracking number is present */}
      {order.tracking_number && (
        <div className="px-5 py-4 flex items-center gap-2 text-sm text-gray-600 bg-gray-50">
          <Package size={14} className="text-gray-400 shrink-0" aria-hidden="true" />
          <span>
            Tracking:{" "}
            <span className="font-mono font-medium text-gray-800">
              {order.tracking_number}
            </span>
          </span>
        </div>
      )}
    </article>
  );
}

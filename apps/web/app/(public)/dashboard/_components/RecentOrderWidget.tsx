/**
 * RecentOrderWidget — dashboard card showing the customer's most recent merch order.
 * Returns null if the customer has no orders (hides the widget entirely).
 * Used by: app/(public)/dashboard/page.tsx
 */

import Link from "next/link";
import type { RecentOrderWidget as RecentOrderWidgetType } from "@/types/orders";

interface RecentOrderWidgetProps {
  order: RecentOrderWidgetType | null;
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
  paid: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Renders a compact summary of the customer's most recent merch order. Returns null if no orders. */
export default function RecentOrderWidget({ order }: RecentOrderWidgetProps) {
  if (!order) return null;

  const total = order.total_amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Recent Order</h2>
        <Link
          href="/dashboard/orders"
          className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
        >
          View all orders
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-gray-500">
            Placed on{" "}
            {new Date(order.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <span
            className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
              statusStyles[order.status] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {statusLabels[order.status] ?? order.status}
          </span>
        </div>

        <ul className="flex flex-col gap-1">
          {order.order_items.map((item, idx) => (
            <li key={idx} className="text-sm text-gray-700">
              {item.product_variants.products.name} ({item.product_variants.size}) x
              {item.quantity}
            </li>
          ))}
        </ul>

        <p className="text-sm font-semibold text-gray-900">Total: {total}</p>

        {order.tracking_number && (
          <p className="text-xs text-gray-500">
            Tracking:{" "}
            <code className="font-mono">{order.tracking_number}</code>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * OrdersList — vertical stack of OrderCard components, or an empty state.
 * Used by: app/(public)/dashboard/orders/page.tsx
 */

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import OrderCard from "./OrderCard";
import type { OrderRecord } from "@/types/orders";

interface OrdersListProps {
  orders: OrderRecord[];
}

/** Renders all order cards stacked vertically, or a "no orders" empty state. */
export default function OrdersList({ orders }: OrdersListProps) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-gray-200 rounded-lg">
        <ShoppingBag
          size={40}
          className="text-gray-300 mb-4"
          aria-hidden="true"
        />
        <p className="font-semibold text-gray-700 mb-1">No orders yet</p>
        <p className="text-sm text-gray-500 mb-6">
          Pick up some SuperHeroCPR gear in our merch store.
        </p>
        <Link
          href="/merch"
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors duration-150"
        >
          Shop Merch
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

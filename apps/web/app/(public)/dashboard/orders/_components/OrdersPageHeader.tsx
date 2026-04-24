/**
 * OrdersPageHeader — static header for /dashboard/orders.
 * Used by: app/(public)/dashboard/orders/page.tsx
 */

/** Renders the page title and subtitle for the My Orders page. */
export default function OrdersPageHeader() {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-6">
      <h1 className="text-2xl font-bold text-gray-900">My Orders</h1>
      <p className="text-gray-500 mt-1 text-sm">
        View your merchandise orders and tracking information.
      </p>
    </div>
  );
}

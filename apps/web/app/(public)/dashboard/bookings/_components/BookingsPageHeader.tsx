/**
 * BookingsPageHeader — static header for /dashboard/bookings.
 * Used by: app/(public)/dashboard/bookings/page.tsx
 */

/** Renders the page title and subtitle for the My Bookings page. */
export default function BookingsPageHeader() {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-6">
      <h1 className="text-2xl font-bold text-gray-900">My Bookings</h1>
      <p className="text-gray-500 mt-1 text-sm">
        View all your upcoming and past CPR certification classes.
      </p>
    </div>
  );
}

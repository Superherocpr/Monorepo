/**
 * DashboardWelcome — full-width welcome header at the top of /dashboard.
 * Displays a personalized greeting using the customer's first name from the DB.
 * Used by: app/(public)/dashboard/page.tsx
 */

interface DashboardWelcomeProps {
  firstName: string;
}

/** Renders the personalized welcome heading for the dashboard overview page. */
export default function DashboardWelcome({ firstName }: DashboardWelcomeProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-6">
      <h1 className="text-2xl font-bold text-gray-900">
        Welcome back, {firstName}!
      </h1>
      <p className="text-gray-500 mt-1 text-sm">
        Here&apos;s an overview of your classes and certifications.
      </p>
    </div>
  );
}

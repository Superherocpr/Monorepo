/**
 * CertificationsPageHeader — static header for /dashboard/certifications.
 * Used by: app/(public)/dashboard/certifications/page.tsx
 */

/** Renders the page title and subtitle for the My Certifications page. */
export default function CertificationsPageHeader() {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-6">
      <h1 className="text-2xl font-bold text-gray-900">My Certifications</h1>
      <p className="text-gray-500 mt-1 text-sm">
        Track your active CPR certifications and renewal dates.
      </p>
    </div>
  );
}

/**
 * SettingsPageHeader — static header for /dashboard/settings.
 * Used by: app/(public)/dashboard/settings/page.tsx
 */

/** Renders the page title and subtitle for the Account Settings page. */
export default function SettingsPageHeader() {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-6">
      <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
      <p className="text-gray-500 mt-1 text-sm">
        Manage your personal information, email, and password.
      </p>
    </div>
  );
}

/**
 * RenewalCtaBanner — amber call-to-action banner shown when the customer has
 * at least one certification expiring within 60 days.
 * Only rendered when hasExpiringSoon is true — caller controls visibility.
 * Used by: app/(public)/dashboard/certifications/page.tsx
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Renders the amber renewal prompt banner. Caller must conditionally render this component. */
export default function RenewalCtaBanner() {
  return (
    <div
      role="alert"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-lg px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={18}
          className="text-amber-500 mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-amber-900 text-sm">
            Renewal coming up
          </p>
          <p className="text-amber-800 text-sm mt-0.5">
            One or more of your certifications expire within the next 60 days.
            Book your renewal class to stay certified.
          </p>
        </div>
      </div>
      <Link
        href="/book"
        className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors duration-150"
      >
        Book Renewal
      </Link>
    </div>
  );
}

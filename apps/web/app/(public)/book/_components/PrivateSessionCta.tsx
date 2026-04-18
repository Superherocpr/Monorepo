/**
 * PrivateSessionCta — "Can't Find a Time?" CTA below the session list.
 * Static content only, no data fetching.
 * Used by: app/(public)/book/_components/BookSessionSelector.tsx
 */

import Link from "next/link";

/** Renders the private group session call-to-action. */
export default function PrivateSessionCta() {
  return (
    <section className="py-16 px-4 bg-gray-50 text-center">
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Can&apos;t Find a Time That Works?
        </h2>
        <p className="text-gray-600 leading-relaxed">
          We offer private group sessions at your home, office, or facility.
          Contact us to arrange a session that fits your schedule.
        </p>
        <Link
          href="/contact"
          className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150"
        >
          Contact Us
        </Link>
      </div>
    </section>
  );
}

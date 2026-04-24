/**
 * ClassesCtaSection — red CTA banner at the bottom of the /classes page.
 * Static content only, no data fetching.
 * Used by: app/(public)/classes/page.tsx
 */

import Link from "next/link";

/** Renders the red "Ready to Get Started?" call-to-action banner. */
export default function ClassesCtaSection() {
  return (
    <section className="py-20 px-4 bg-red-700 text-center">
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-6">
        <h2 className="text-3xl font-bold tracking-tight text-white">
          Ready to Get Started?
        </h2>
        <p className="text-red-100 text-lg leading-relaxed">
          Browse available class dates or book your session now. Tampa Bay
          area. Weekdays, evenings, and weekends available.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/book"
            className="bg-white text-red-700 font-semibold px-6 py-3 rounded-lg hover:bg-red-50 transition-colors duration-150"
          >
            Book a Class
          </Link>
          <Link
            href="/schedule"
            className="border-2 border-white text-white font-semibold px-6 py-3 rounded-lg hover:bg-red-600 transition-colors duration-150"
          >
            View Schedule
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * AboutCtaSection — red CTA banner at the bottom of the /about page.
 * Static content only, no data fetching.
 * Used by: app/(public)/about/page.tsx
 */

import Link from "next/link";

/** Renders the red "Ready to Become Certified?" call-to-action banner. */
export default function AboutCtaSection() {
  return (
    <section className="py-20 px-4 bg-red-700 text-center">
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-6">
        <h2 className="text-3xl font-bold tracking-tight text-white">
          Ready to Become Certified?
        </h2>
        <p className="text-red-100 text-lg leading-relaxed">
          Join thousands of students who have trained with SuperHeroCPR.
          Classes available weekdays, evenings, and weekends.
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
            className="text-white font-medium hover:text-red-100 transition-colors duration-150 underline underline-offset-4"
          >
            View the schedule
          </Link>
        </div>
      </div>
    </section>
  );
}

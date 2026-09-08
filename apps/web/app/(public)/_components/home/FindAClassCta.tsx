/**
 * FindAClassCta — home page entry point into the /find-a-class walkthrough.
 *
 * Sits directly under the hero because "which class do I need?" is the question
 * that drives most inbound phone calls. Getting it in front of visitors before
 * the catalog is the point: the class grid further down only helps someone who
 * already knows what the course names mean.
 *
 * Static server component. Used by: app/(public)/page.tsx
 */

import Link from "next/link";
import { Compass } from "lucide-react";

/** Renders the guided class-finder call to action. */
export default function FindAClassCta(): React.ReactElement {
  return (
    <section className="py-16 px-4 bg-white" aria-labelledby="find-a-class-heading">
      <div className="max-w-4xl mx-auto">
        <div className="border border-gray-200 rounded-xl p-8 sm:p-10 flex flex-col sm:flex-row sm:items-center gap-6">
          <div
            className="shrink-0 w-14 h-14 rounded-full bg-red-50 flex items-center justify-center"
            aria-hidden="true"
          >
            <Compass size={26} className="text-red-600" />
          </div>

          <div className="flex-1">
            <h2
              id="find-a-class-heading"
              className="text-2xl font-bold tracking-tight text-gray-900 text-balance"
            >
              Not sure which class you need?
            </h2>
            <p className="text-gray-600 leading-relaxed mt-2">
              BLS, Heartsaver, First Aid, certified or not. Answer a few
              questions and we will tell you exactly which course your job or
              your family calls for, then show you the next available date.
            </p>
          </div>

          <div className="shrink-0">
            <Link
              href="/find-a-class"
              className="inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 w-full sm:w-auto"
            >
              Find my class
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

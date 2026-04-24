/**
 * FinalCtaSection — high-contrast red CTA banner at the bottom of the home page.
 * Static content only, no data fetching.
 * Used by: app/(public)/page.tsx
 */

import Link from "next/link";

/** Renders the "Be ready when it matters most" final CTA banner. */
export default function FinalCtaSection() {
  return (
    <section className="py-20 px-4 bg-red-700 text-center">
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-5">
        <p className="text-red-200 text-sm font-semibold uppercase tracking-widest">
          70–80% of all cardiac arrests happen at home.
        </p>
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
          Be ready when it matters most.
        </h2>
        <p className="text-red-100 text-lg leading-relaxed">
          Schedule a class for you, your family, or your entire team. Classes
          fill up fast.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
          <Link
            href="/book"
            className="bg-white text-red-700 font-semibold px-8 py-3.5 rounded-lg hover:bg-red-50 transition-colors duration-150"
          >
            Book Your Class Now
          </Link>
          <Link
            href="/contact"
            className="text-white/80 hover:text-white text-sm font-medium transition-colors duration-150"
          >
            Have questions? Contact us
          </Link>
        </div>
      </div>
    </section>
  );
}

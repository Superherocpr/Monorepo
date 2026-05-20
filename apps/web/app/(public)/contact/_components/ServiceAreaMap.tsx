/**
 * ServiceAreaMap — service area visualization on the /contact page.
 * Covers Hillsborough, Manatee, and Sarasota Counties.
 * Static section, no data fetching.
 * Used by: app/(public)/contact/page.tsx
 */

/** Renders the service area map placeholder section. */
export default function ServiceAreaMap() {
  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-3">
          Serving Hillsborough, Manatee &amp; Sarasota Counties
        </h2>
        <p className="text-center text-gray-600 mb-8 max-w-xl mx-auto">
          On-location classes available throughout Hillsborough, Manatee, and
          Sarasota Counties on Florida&apos;s Gulf Coast.
        </p>

        {/*
         * Google Maps standard embed — free, no API key required.
         * Centered on 27.5°N, 82.35°W at zoom 9 to show the full
         * Hillsborough, Manatee, and Sarasota County footprint.
         */}
        <div className="w-full h-64 md:h-96 rounded-xl overflow-hidden">
          <iframe
            title="Hillsborough, Manatee, and Sarasota Counties service area map"
            src="https://maps.google.com/maps?q=27.5,-82.35&z=9&output=embed"
            className="w-full h-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </section>
  );
}

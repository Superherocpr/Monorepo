/**
 * ServiceAreaMap — Tampa Bay service area visualization on the /contact page.
 * Static section, no data fetching.
 * Used by: app/(public)/contact/page.tsx
 */

/** Renders the service area map placeholder section. */
export default function ServiceAreaMap() {
  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-3">
          Serving the Tampa Bay Area
        </h2>
        <p className="text-center text-gray-600 mb-8 max-w-xl mx-auto">
          On-location classes available throughout Tampa, St. Petersburg,
          Clearwater, Brandon, Wesley Chapel, and surrounding areas.
        </p>

        {/*
         * TODO: Replace with static map image — see /public/images/tampa-bay-map.png
         * or use the Google Static Maps API once the API key is available:
         * https://maps.googleapis.com/maps/api/staticmap?center=Tampa,FL&zoom=10&size=1200x400&scale=2&maptype=roadmap&key=YOUR_API_KEY
         */}
        <div
          className="w-full h-64 md:h-96 bg-gray-200 rounded-xl flex items-center justify-center text-gray-500 text-sm font-medium"
          role="img"
          aria-label="Tampa Bay Area Service Map placeholder"
        >
          Tampa Bay Area Service Map
        </div>
      </div>
    </section>
  );
}

/**
 * ScheduleHeroSection — compact hero banner for the /schedule page.
 * Static content only, no data fetching.
 * Used by: app/(public)/schedule/page.tsx
 */

/** Renders the "Available Classes" hero header. */
export default function ScheduleHeroSection() {
  return (
    <section className="bg-gray-900 py-16 text-center px-4">
      <div className="max-w-3xl mx-auto">
        <p className="text-red-500 text-sm font-semibold uppercase tracking-widest mb-3">
          Available Classes
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
          Find a Class Near You
        </h1>
        <p className="text-gray-300 text-lg leading-relaxed">
          Browse upcoming CPR certification sessions in the Tampa Bay area.
          Spots fill up fast — book early to secure your place.
        </p>
      </div>
    </section>
  );
}

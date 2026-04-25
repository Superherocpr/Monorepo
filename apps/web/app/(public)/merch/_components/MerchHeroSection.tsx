/**
 * MerchHeroSection — compact hero banner for the /merch page.
 * Static content only, no data fetching.
 * Used by: app/(public)/merch/page.tsx
 */

/** Renders the "Gear Up" hero header. */
export default function MerchHeroSection() {
  return (
    <section className="bg-gray-900 py-16 text-center px-4">
      <div className="max-w-3xl mx-auto">
        <p className="text-red-500 text-sm font-semibold uppercase tracking-widest mb-3">
          Gear Up
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
          SuperHeroCPR Merch
        </h1>
        <p className="text-gray-300 text-lg leading-relaxed">
          Rep the mission. Every purchase helps spread the word about CPR awareness.
        </p>
      </div>
    </section>
  );
}

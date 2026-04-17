/**
 * AboutHeroSection — hero banner for the /about page.
 * Static content only, no data fetching.
 * Used by: app/(public)/about/page.tsx
 */

/** Renders the "Our Story" hero section header for the about page. */
export default function AboutHeroSection() {
  return (
    <section className="bg-gray-900 py-20 text-center px-4">
      <div className="max-w-3xl mx-auto">
        <p className="text-red-500 text-sm font-semibold uppercase tracking-widest mb-3">
          Our Story
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
          Saving Lives Is Our Passion
        </h1>
        <p className="text-gray-300 text-lg leading-relaxed">
          Superhero CPR was founded on one simple belief — everyone deserves to
          know how to save a life. We bring American Heart Association
          certification training directly to you, wherever you are.
        </p>
      </div>
    </section>
  );
}

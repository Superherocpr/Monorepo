/**
 * MerchHeroSection — compact hero banner for the /merch page.
 * Static content only, no data fetching.
 * Used by: app/(public)/merch/page.tsx
 */

/** Renders the "Gear Up" hero header. */
export default function MerchHeroSection() {
  return (
    <section
      className="relative text-center px-4 py-16 overflow-hidden"
      style={{ backgroundColor: "#d4a000" }}
    >
      {/* Character — anchored left, waist-high crop */}
      <div
        className="absolute bottom-0 left-0 pointer-events-none select-none"
        style={{ transform: "translateY(calc(50% + 10px))" }}
        aria-hidden="true"
      >
        <img
          src="/images/MainMaleHero1.svg"
          alt=""
          className="h-[700px] w-auto object-contain"
          style={{ transform: "scaleX(-1)" }}
        />
      </div>

      {/* Radial gradient — darkens center for text readability, fades to transparent at edges */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)" }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-3xl mx-auto">
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

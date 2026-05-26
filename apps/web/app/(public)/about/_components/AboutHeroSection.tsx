/**
 * AboutHeroSection — hero banner for the /about page.
 * Static content only, no data fetching.
 * Used by: app/(public)/about/page.tsx
 */

import Image from "next/image";

/**
 * Renders the "Our Story" hero section header for the about page.
 * @returns The about page hero section.
 */
export default function AboutHeroSection() {
  return (
    <section
      className="relative text-center px-4 py-20 overflow-hidden"
      style={{ backgroundColor: "#1a5c2e" }}
    >
      <div
        className="absolute bottom-0 right-0 h-[700px] w-[323px] pointer-events-none select-none"
        style={{ transform: "translateY(50%)" }}
        aria-hidden="true"
      >
        <Image
          src="/images/MainFemaleHero1_white.svg"
          alt=""
          fill
          className="object-contain"
          priority
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
          Our Story
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
          Saving Lives Is Our Passion
        </h1>
        <p className="text-gray-300 text-lg leading-relaxed">
          SuperHeroCPR was founded on one simple belief — everyone deserves to
          know how to save a life. We bring American Heart Association
          certification training directly to you, wherever you are.
        </p>
      </div>
    </section>
  );
}

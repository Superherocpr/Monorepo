/**
 * ContactHeroSection — compact hero banner for the /contact page.
 * Static content only, no data fetching.
 * Used by: app/(public)/contact/page.tsx
 */

/** Renders the "Get In Touch" hero header. */
export default function ContactHeroSection() {
  return (
    <section
      className="relative text-center px-4 py-16 overflow-hidden"
      style={{ backgroundColor: "#0a5a8a" }}
    >
      <div
        className="absolute bottom-0 left-0 pointer-events-none select-none"
        style={{ transform: "translateY(50%)" }}
        aria-hidden="true"
      >
        <img
          src="/images/MainMaleHero2.svg"
          alt=""
          className="h-[700px] w-auto object-contain"
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
          Get In Touch
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
          We'd Love to Hear From You
        </h1>
        <p className="text-gray-300 text-lg leading-relaxed">
          Have a question about our classes? Interested in group or corporate
          training? Reach out and we'll get back to you as soon as possible.
        </p>
      </div>
    </section>
  );
}

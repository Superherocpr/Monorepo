/**
 * ClassesHeroSection — hero banner for the /classes page.
 * Static content only, no data fetching.
 * Used by: app/(public)/classes/page.tsx
 */

/** Renders the "Our Courses" hero section header. */
export default function ClassesHeroSection() {
  return (
    <section
      className="relative text-center px-4 py-20 overflow-hidden"
      style={{ backgroundColor: "#c45000" }}
    >
      {/*
       * Female hero — anchored to the right edge, waist-high crop.
       * translateY(50%) pushes the image down so only the top half is visible;
       * overflow-hidden on the section clips the rest.
       * Height is viewport-relative so it scales with window size.
       */}
      {/* Character — anchored right, waist-high crop */}
      <div
        className="absolute bottom-0 right-0 pointer-events-none select-none"
        style={{ transform: "translateY(50%)" }}
        aria-hidden="true"
      >
        <img
          src="/images/MainFemaleHero3.svg"
          alt=""
          className="h-[85vh] w-auto object-contain"
        />
      </div>

      {/* Radial gradient — darkens center for text readability, fades to transparent at edges */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)" }}
        aria-hidden="true"
      />

      <div className="relative z-10 max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight text-white mb-4">
          American Heart Association Certification Classes
        </h1>
        <p className="text-gray-300 text-lg leading-relaxed">
          We offer a full range of AHA-certified CPR courses for healthcare
          professionals, workplace teams, and everyday people who want to be
          ready when it counts.
        </p>
      </div>
    </section>
  );
}

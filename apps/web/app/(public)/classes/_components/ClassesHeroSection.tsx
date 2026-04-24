/**
 * ClassesHeroSection — hero banner for the /classes page.
 * Static content only, no data fetching.
 * Used by: app/(public)/classes/page.tsx
 */

/** Renders the "Our Courses" hero section header. */
export default function ClassesHeroSection() {
  return (
    <section className="bg-gray-900 py-20 text-center px-4">
      <div className="max-w-3xl mx-auto">
        <p className="text-red-500 text-sm font-semibold uppercase tracking-widest mb-3">
          Our Courses
        </p>
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

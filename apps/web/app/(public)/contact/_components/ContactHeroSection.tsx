/**
 * ContactHeroSection — compact hero banner for the /contact page.
 * Static content only, no data fetching.
 * Used by: app/(public)/contact/page.tsx
 */

/** Renders the "Get In Touch" hero header. */
export default function ContactHeroSection() {
  return (
    <section className="bg-gray-900 py-16 text-center px-4">
      <div className="max-w-3xl mx-auto">
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

/**
 * AhaAffiliationSection — AHA certification badge + copy on the /about page.
 * Static content only, no data fetching.
 * Used by: app/(public)/about/page.tsx
 */

/** Renders the American Heart Association affiliation section. */
export default function AhaAffiliationSection() {
  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Logo placeholder */}
          <div className="flex items-center justify-center lg:justify-start">
            {/* TODO: add official AHA logo asset to /public/images/aha-logo.png and replace this placeholder */}
            <div className="w-48 h-48 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm text-center px-4">
              American Heart Association Logo
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold text-gray-900">
              American Heart Association Certified
            </h2>
            <p className="text-gray-600 leading-relaxed">
              The American Heart Association is the world's leading nonprofit
              organization focused on heart disease and stroke. AHA
              certification is the gold standard recognized by employers,
              hospitals, and healthcare organizations nationwide. When you
              train with Superhero CPR, you receive official AHA
              certification — the same standard required by healthcare
              professionals.
            </p>
            <p className="text-sm text-gray-500">
              Superhero CPR is an authorized American Heart Association
              Training Site.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

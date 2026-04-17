/**
 * MissionSection — "Why We Do This" values grid on the /about page.
 * Static content only, no data fetching.
 * Used by: app/(public)/about/page.tsx
 */

import { Heart, Award, Home } from "lucide-react";

const VALUES = [
  {
    icon: Heart,
    title: "Passion for Life",
    // TODO: replace placeholder copy with final mission text
    description:
      "Every class we teach is driven by a genuine belief that CPR knowledge saves lives. We have seen it firsthand.",
  },
  {
    icon: Award,
    title: "Gold Standard Training",
    // TODO: replace placeholder copy with final mission text
    description:
      "We teach exclusively to American Heart Association standards — the most trusted name in emergency cardiovascular care.",
  },
  {
    icon: Home,
    title: "We Come to You",
    // TODO: replace placeholder copy with final mission text
    description:
      "No commute, no unfamiliar classroom. We bring the training to your home, your office, or your facility.",
  },
] as const;

/** Renders the three-column mission and values section. */
export default function MissionSection() {
  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-12">
          Why We Do This
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {VALUES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex flex-col items-center text-center gap-4">
              <Icon className="text-red-600" size={40} aria-hidden="true" />
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              <p className="text-gray-600 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

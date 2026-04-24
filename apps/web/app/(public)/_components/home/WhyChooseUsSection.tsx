/**
 * WhyChooseUsSection — 4-feature card grid on the home page.
 * Static content only, no data fetching.
 * Used by: app/(public)/page.tsx
 */

import { Shield, Clock, MapPin, Users } from "lucide-react";

const FEATURES = [
  {
    icon: Shield,
    title: "AHA Certified Instruction",
    description:
      "Receive training from a licensed American Heart Association instructor — the gold standard in CPR certification.",
  },
  {
    icon: Clock,
    title: "Flexible Scheduling",
    description:
      "Morning, afternoon, or evening classes on weekdays and weekends, including most holidays.",
  },
  {
    icon: MapPin,
    title: "We Come to You",
    description:
      "On-location classes at your home, office, or facility. No need to travel.",
  },
  {
    icon: Users,
    title: "Real-World Experience",
    description:
      "Learn from an instructor with thousands of documented real-world CPR patients from active Fire, EMS, and ER response.",
  },
] as const;

/** Renders the 4-card "Why Choose Us" feature grid. */
export default function WhyChooseUsSection() {
  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-4"
            >
              <Icon
                className="text-red-600"
                size={32}
                aria-hidden="true"
              />
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">
                  {title}
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * HowItWorksSection — 4-step process explanation on the /classes page.
 * Static content only, no data fetching.
 * Used by: app/(public)/classes/page.tsx
 */

import { BookOpen, Calendar, CreditCard, Award } from "lucide-react";

const STEPS = [
  {
    number: 1,
    icon: BookOpen,
    title: "Choose your class",
    description:
      "Browse our AHA-certified courses and pick the one that fits your needs.",
  },
  {
    number: 2,
    icon: Calendar,
    title: "Pick a date",
    description:
      "View available sessions and choose a date and time that works for your schedule.",
  },
  {
    number: 3,
    icon: CreditCard,
    title: "Pay online",
    description:
      "Securely complete your booking with PayPal. Payment is required to hold your spot.",
  },
  {
    number: 4,
    icon: Award,
    title: "Get certified",
    description:
      "Attend your class, pass your skills test, and walk away with your AHA certification.",
  },
] as const;

/**
 * Renders the "How It Works" four-step section.
 * Steps are horizontal on desktop (lg+) and stacked vertically on mobile.
 */
export default function HowItWorksSection() {
  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-12">
          How It Works
        </h2>

        <div className="flex flex-col lg:flex-row items-start gap-8 lg:gap-0">
          {STEPS.map(({ number, icon: Icon, title, description }, index) => (
            <div key={number} className="flex lg:flex-1 items-start lg:flex-col lg:items-center gap-4 lg:gap-0 relative">

              {/* Step content */}
              <div className="flex flex-col lg:items-center lg:text-center gap-2 lg:px-6">
                {/* Step number */}
                <span className="text-4xl font-bold text-red-600 leading-none">
                  {number}
                </span>
                {/* Icon */}
                <Icon
                  className="text-red-600 mt-1 lg:mt-2"
                  size={32}
                  aria-hidden="true"
                />
                {/* Text */}
                <div className="mt-2">
                  <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed mt-1">
                    {description}
                  </p>
                </div>
              </div>

              {/* Connector line between steps — desktop only, not shown after last step */}
              {index < STEPS.length - 1 && (
                <div
                  className="hidden lg:block absolute top-6 left-1/2 w-full h-px bg-gray-200"
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

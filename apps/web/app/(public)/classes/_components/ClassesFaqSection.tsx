"use client";

/**
 * ClassesFaqSection — accordion FAQ on the /classes page.
 * Client component — manages which accordion item is currently open.
 * One item open at a time. Built with useState + CSS transitions only (no library).
 * Used by: app/(public)/classes/page.tsx
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    question: "What should I bring to class?",
    answer:
      "Nothing special is required. Wear comfortable clothing you can move in — you will be practicing CPR techniques on a mannequin. We bring all the training equipment.",
  },
  {
    question: "How long is my AHA certification valid?",
    answer:
      "Most AHA certifications are valid for 2 years. You will receive a reminder before your certification expires so you can schedule a renewal class.",
  },
  {
    question: "Can I book a class for my entire team or workplace?",
    answer:
      "Absolutely. We specialize in on-location group training at your facility or workplace. Contact us to arrange a session for your team.",
  },
  {
    question: "What is the difference between BLS and Heartsaver?",
    answer:
      "BLS (Basic Life Support) is designed for healthcare professionals and requires hands-on skills testing. Heartsaver is designed for non-medical workplace responders and the general public. Both result in full AHA certification.",
  },
  {
    question: "Do I need any prior experience or training?",
    answer:
      "No prior experience is required for any of our courses. Our instructors guide you through everything step by step.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "Online bookings are paid securely through PayPal. In-person payments can be made by cash or check.",
  },
  {
    question: "Is the certification accepted by hospitals and employers?",
    answer:
      "Yes. AHA certification from Superhero CPR is recognized by hospitals, clinics, schools, and employers nationwide.",
  },
  {
    question: "What happens if I need to cancel my booking?",
    answer:
      "Please contact us as soon as possible if you need to cancel. We do not offer refunds, but we will do our best to accommodate rescheduling.",
  },
] as const;

/**
 * Renders an accordion FAQ list.
 * Only one item is open at a time. Uses max-height CSS transition for animation.
 */
export default function ClassesFaqSection() {
  // null = all items closed
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function handleToggle(index: number) {
    setOpenIndex((prev) => (prev === index ? null : index));
  }

  return (
    <section id="faq" className="py-20 px-4 bg-white">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-10">
          Frequently Asked Questions
        </h2>

        <div className="flex flex-col divide-y divide-gray-200 border-t border-gray-200">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            const triggerId = `faq-trigger-${index}`;

            return (
              <div key={index}>
                {/* Trigger row */}
                <button
                  id={triggerId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => handleToggle(index)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left text-gray-900 font-medium hover:text-red-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-sm"
                >
                  <span>{faq.question}</span>
                  {/*
                   * Chevron rotation is driven by a class, not inline style,
                   * so it respects prefers-reduced-motion via Tailwind's motion-safe variant.
                   */}
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className={[
                      "shrink-0 text-gray-400 motion-safe:transition-transform motion-safe:duration-200",
                      isOpen ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>

                {/* Answer panel — CSS max-height transition */}
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={triggerId}
                  className={[
                    "overflow-hidden motion-safe:transition-all motion-safe:duration-200",
                    isOpen ? "max-h-96" : "max-h-0",
                  ].join(" ")}
                >
                  <p className="pb-5 text-gray-600 leading-relaxed text-sm">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

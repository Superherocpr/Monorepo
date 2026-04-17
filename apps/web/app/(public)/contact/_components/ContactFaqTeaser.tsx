/**
 * ContactFaqTeaser — three static Q&A pairs on the /contact page.
 * Links to the full FAQ accordion at /classes#faq.
 * Static content only, no data fetching. No accordion — items are always open.
 * Used by: app/(public)/contact/page.tsx
 */

import Link from "next/link";

const FAQS = [
  {
    question: "How far in advance should I book?",
    answer:
      "We recommend booking at least a few days in advance as classes fill up quickly. Check the schedule for current availability.",
  },
  {
    question: "Do you offer group or corporate training?",
    answer:
      "Yes — we specialize in on-location group training for workplaces, facilities, and families. Contact us to arrange a private session.",
  },
  {
    question: "What if I need to reschedule?",
    answer:
      "Contact us as soon as possible and we will do our best to accommodate you. Please note that we do not offer refunds.",
  },
] as const;

/** Renders three static FAQ pairs with a link to the full FAQ at /classes#faq. */
export default function ContactFaqTeaser() {
  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-10">
          Quick Answers
        </h2>

        <div className="flex flex-col gap-8 text-left">
          {FAQS.map(({ question, answer }) => (
            <div key={question}>
              <h3 className="text-base font-semibold text-gray-900 mb-2">
                {question}
              </h3>
              <p className="text-gray-600 leading-relaxed text-sm">{answer}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <Link
            href="/classes#faq"
            className="text-red-600 font-medium hover:text-red-700 transition-colors duration-150"
          >
            See all FAQs →
          </Link>
        </div>
      </div>
    </section>
  );
}

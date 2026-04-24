"use client";

/**
 * TestimonialsSection — auto-rotating testimonial carousel on the home page.
 * Client component — owns carousel state and auto-advance timer.
 * Built with useState + useEffect only (no third-party carousel library).
 * Respects prefers-reduced-motion for accessibility.
 * Used by: app/(public)/page.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Testimonial {
  quote: string;
  author: string;
  organization: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "I have been CPR certified for 40 consecutive years. That's A LOT of CPR classes. The absolute best class I ever attended was yours, last week at Casa Mora. Your teaching style combined with your knowledge and love of the material created a positive learning experience for us all. It is so obvious that saving lives is your passion as well as enabling others to do so.",
    author: "Holly Duncan RN, BSN",
    organization: "Casa Mora Rehabilitation & Extended Care",
  },
];

const AUTO_ADVANCE_MS = 6000;

/** Renders the "What Our Students Say" auto-rotating testimonial carousel. */
export default function TestimonialsSection() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = TESTIMONIALS.length;

  const goNext = useCallback(() => {
    setIndex((prev) => (prev + 1) % count);
  }, [count]);

  const goPrev = useCallback(() => {
    setIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  // Auto-advance every 6 seconds unless paused or only 1 testimonial
  useEffect(() => {
    if (count <= 1 || paused) return;

    // Respect prefers-reduced-motion — do not auto-advance for users who opt out of motion
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) return;

    const id = setInterval(goNext, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [count, paused, goNext]);

  const current = TESTIMONIALS[index];

  return (
    <section
      className="py-20 px-4 bg-gray-50"
      aria-label="Testimonials"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-12">
          What Our Students Say
        </h2>

        <div className="relative">
          {/* Testimonial card */}
          <article
            key={index}
            className="bg-white border-l-4 border-red-600 rounded-xl px-8 py-8 shadow-sm"
          >
            <blockquote>
              <p className="text-lg italic text-gray-700 leading-relaxed mb-6">
                &ldquo;{current.quote}&rdquo;
              </p>
              <footer>
                <span className="font-bold text-gray-900">{current.author}</span>
                {current.organization && (
                  <span className="text-gray-500 text-sm block mt-0.5">
                    {current.organization}
                  </span>
                )}
              </footer>
            </blockquote>
          </article>

          {/* Prev/Next controls — only shown when more than one testimonial */}
          {count > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={goPrev}
                aria-label="Previous testimonial"
                className="p-2 rounded-full border border-gray-200 hover:border-red-300 text-gray-500 hover:text-red-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>

              {/* Dot indicators */}
              <div className="flex gap-2" role="tablist" aria-label="Testimonials">
                {TESTIMONIALS.map((_, i) => (
                  <button
                    key={i}
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`Testimonial ${i + 1}`}
                    onClick={() => setIndex(i)}
                    className={[
                      "w-2 h-2 rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                      i === index ? "bg-red-600" : "bg-gray-300 hover:bg-gray-400",
                    ].join(" ")}
                  />
                ))}
              </div>

              <button
                onClick={goNext}
                aria-label="Next testimonial"
                className="p-2 rounded-full border border-gray-200 hover:border-red-300 text-gray-500 hover:text-red-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * HeroSection — full-viewport hero for the home page.
 * Server component — fetches the next upcoming approved class session.
 * Used by: app/(public)/page.tsx
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

/** Formats an ISO datetime to e.g. "Tuesday, April 22 at 9:00 AM". */
function formatNextClass(isoDate: string): string {
  const date = new Date(isoDate);
  const datePart = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart} at ${timePart}`;
}

/** Renders the full-viewport home page hero with live "next class" data. */
export default async function HeroSection() {
  const supabase = await createClient();

  // Fetch the next upcoming approved class session
  // Must be approved — unapproved sessions do not appear publicly
  const { data: nextSession } = await supabase
    .from("class_sessions")
    .select("starts_at, class_types(name), locations(name)")
    .eq("status", "scheduled")
    .eq("approval_status", "approved")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .single();

  const nextClassText =
    nextSession && nextSession.class_types && nextSession.starts_at
      ? `Next class: ${(nextSession.class_types as unknown as { name: string }).name} — ${formatNextClass(nextSession.starts_at)}`
      : null;

  return (
    <section
      className="relative flex items-center justify-center min-h-screen px-4 text-center"
      aria-label="Hero"
    >
      {/*
       * TODO: replace this placeholder background with the final CPR/first-aid hero image.
       * Save image to /public/images/hero-bg.jpg and update the className below.
       */}
      <div
        className="absolute inset-0 bg-gray-900"
        aria-hidden="true"
      />
      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />

      <div className="relative z-10 max-w-4xl mx-auto flex flex-col items-center gap-6">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight">
          CPR Certification Classes That Could Save a Life
        </h1>

        <p className="text-lg md:text-xl text-gray-200 leading-relaxed max-w-2xl">
          Learn from a licensed American Heart Association instructor with
          thousands of real-world CPR patients. Flexible scheduling.
          On-location classes. Tampa Bay area.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
          <Link
            href="/book"
            className="bg-red-600 hover:bg-red-700 text-white font-semibold px-8 py-3.5 rounded-lg transition-colors duration-150 text-base"
          >
            Book a Class
          </Link>
          <Link
            href="/schedule"
            className="border-2 border-white text-white font-semibold px-8 py-3.5 rounded-lg hover:bg-white/10 transition-colors duration-150 text-base"
          >
            View Schedule
          </Link>
        </div>

        {/* Next available class — hidden when no upcoming sessions exist */}
        {nextClassText && (
          <p className="text-sm text-gray-300 mt-1">{nextClassText}</p>
        )}
      </div>
    </section>
  );
}

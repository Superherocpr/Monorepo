/**
 * / (home page) — the main public-facing landing page for SuperHeroCPR.
 * Server component. Each section independently fetches its own data.
 *
 * Honors the system_settings.legacy_site_enabled flag (toggled from
 * /admin/settings). When the flag is "true", renders the legacy single-page
 * clone of the original WordPress site instead of the modern home page.
 */

import type { Metadata } from "next";
import HeroSection from "./_components/home/HeroSection";
import WhyChooseUsSection from "./_components/home/WhyChooseUsSection";
import ClassTypesSection from "./_components/home/ClassTypesSection";
import TestimonialsSection from "./_components/home/TestimonialsSection";
import AboutInstructorSection from "./_components/home/AboutInstructorSection";
import SocialFeedSection from "./_components/home/SocialFeedSection";
import FinalCtaSection from "./_components/home/FinalCtaSection";
import LegacySitePage from "./_components/legacy/LegacySitePage";
import { getSetting } from "@/lib/zoho";

export const metadata: Metadata = {
  title: "CPR Certification Classes — Tampa Bay | SuperHeroCPR",
  description:
    "American Heart Association CPR certification classes in Tampa Bay. On-location training from a licensed AHA instructor with thousands of real-world patients.",
};

/** Renders the full home page — either the legacy clone or the modern site. */
export default async function HomePage() {
  // Server-side flag check — missing/anything-other-than-"true" defaults to modern site,
  // so the modern page renders even if the system_settings row has not been created yet.
  const legacyFlag = await getSetting("legacy_site_enabled");
  if (legacyFlag === "true") {
    return <LegacySitePage />;
  }

  return (
    <main>
      <HeroSection />
      <WhyChooseUsSection />
      <ClassTypesSection />
      <TestimonialsSection />
      <AboutInstructorSection />
      <SocialFeedSection />
      <FinalCtaSection />
    </main>
  );
}

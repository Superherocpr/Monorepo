/**
 * / (home page) — the main public-facing landing page for SuperHeroCPR.
 * Server component. Each section independently fetches its own data.
 */

import type { Metadata } from "next";
import HeroSection from "./_components/home/HeroSection";
import WhyChooseUsSection from "./_components/home/WhyChooseUsSection";
import ClassTypesSection from "./_components/home/ClassTypesSection";
import TestimonialsSection from "./_components/home/TestimonialsSection";
import AboutInstructorSection from "./_components/home/AboutInstructorSection";
import SocialFeedSection from "./_components/home/SocialFeedSection";
import FinalCtaSection from "./_components/home/FinalCtaSection";

export const metadata: Metadata = {
  title: "CPR Certification Classes — Tampa Bay | SuperHeroCPR",
  description:
    "American Heart Association CPR certification classes in Tampa Bay. On-location training from a licensed AHA instructor with thousands of real-world patients.",
};

/** Renders the full home page. */
export default async function HomePage() {
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

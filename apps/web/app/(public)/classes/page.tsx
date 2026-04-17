/**
 * /classes page — full catalog of CPR course offerings with booking CTAs.
 * All sections are server components except ClassesFaqSection (client — accordion).
 */

import type { Metadata } from "next";
import ClassesHeroSection from "./_components/ClassesHeroSection";
import ClassTypeCards from "./_components/ClassTypeCards";
import HowItWorksSection from "./_components/HowItWorksSection";
import ClassesFaqSection from "./_components/ClassesFaqSection";
import ClassesCtaSection from "./_components/ClassesCtaSection";

export const metadata: Metadata = {
  title: "CPR Certification Classes",
  description:
    "American Heart Association CPR certification classes in Tampa Bay. BLS, Heartsaver, CPR+AED, and Pediatric CPR. Flexible scheduling, on-location training.",
};

/** Renders the full /classes page. */
export default async function ClassesPage() {
  return (
    <main>
      <ClassesHeroSection />
      <ClassTypeCards />
      <HowItWorksSection />
      <ClassesFaqSection />
      <ClassesCtaSection />
    </main>
  );
}

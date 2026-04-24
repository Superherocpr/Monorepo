/**
 * /about page — the human face of Superhero CPR.
 * Introduces the lead instructor, supporting instructors, mission, and AHA affiliation.
 * All sections are server components except InstructorTeamSection (also server).
 */

import type { Metadata } from "next";
import AboutHeroSection from "./_components/AboutHeroSection";
import LeadInstructorSection from "./_components/LeadInstructorSection";
import InstructorTeamSection from "./_components/InstructorTeamSection";
import MissionSection from "./_components/MissionSection";
import AhaAffiliationSection from "./_components/AhaAffiliationSection";
import AboutCtaSection from "./_components/AboutCtaSection";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Meet the team behind Superhero CPR — licensed American Heart Association instructors with real-world experience in Fire, EMS, and Emergency Room response.",
};

/** Renders the full /about page. */
export default async function AboutPage() {
  return (
    <main>
      <AboutHeroSection />
      <LeadInstructorSection />
      <InstructorTeamSection />
      <MissionSection />
      <AhaAffiliationSection />
      <AboutCtaSection />
    </main>
  );
}

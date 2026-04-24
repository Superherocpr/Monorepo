/**
 * /contact page — general inquiries, group bookings, and corporate training requests.
 * ContactSection is a client component; all others are server components.
 */

import type { Metadata } from "next";
import ContactHeroSection from "./_components/ContactHeroSection";
import ContactSection from "./_components/ContactSection";
import ServiceAreaMap from "./_components/ServiceAreaMap";
import ContactFaqTeaser from "./_components/ContactFaqTeaser";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Get in touch with Superhero CPR. Questions about CPR classes, group bookings, or corporate training in the Tampa Bay area.",
};

/** Renders the full /contact page. */
export default function ContactPage() {
  return (
    <main>
      <ContactHeroSection />
      <ContactSection />
      <ServiceAreaMap />
      <ContactFaqTeaser />
    </main>
  );
}

/**
 * ActiveCertificationsList — shows all active/expiring-soon certifications as AHA eCards.
 * Each cert renders as an AHACertCard. A renewal CTA appears beneath the card when the
 * cert is within 90 days of expiry.
 * Renders an empty state with "Book a Class" CTA if the customer has no active certs.
 * Used by: app/(public)/dashboard/certifications/page.tsx
 */

import Link from "next/link";
import { Award, AlertCircle } from "lucide-react";
import { getCertStatus } from "@/lib/cert-utils";
import AHACertCard from "./AHACertCard";
import type { CertificationRecord } from "@/types/certifications";

interface ActiveCertificationsListProps {
  certifications: CertificationRecord[];
  /** Full name of the student — passed through to AHACertCard for display on the card. */
  studentName: string;
}

/** Renders AHA eCard-style certification cards for all active certs, or an empty state with CTA. */
export default function ActiveCertificationsList({
  certifications,
  studentName,
}: ActiveCertificationsListProps) {
  if (certifications.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Active Certifications
        </h2>
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-gray-200 rounded-lg">
          <Award size={40} className="text-gray-300 mb-4" aria-hidden="true" />
          <p className="font-semibold text-gray-700 mb-1">
            No active certifications
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Get certified today — classes are available every week.
          </p>
          <Link
            href="/book"
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors duration-150"
          >
            Book a Class
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Active Certifications
      </h2>
      <div className="flex flex-col gap-4">
        {certifications.map((cert) => {
          const status = getCertStatus(cert.expires_at);
          return (
            <div key={cert.id} className="flex flex-col gap-2">
              <AHACertCard cert={cert} studentName={studentName} />
              {/* Renewal CTA shown beneath the card when the cert is within 90 days of expiry */}
              {status.color !== "green" && (
                <div className="flex justify-end">
                  <Link
                    href="/book"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors duration-150"
                  >
                    <AlertCircle size={14} aria-hidden="true" />
                    Book Renewal Class
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

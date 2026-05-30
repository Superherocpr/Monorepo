/**
 * ExpiredCertificationsList — collapsible section of expired certifications.
 * Each cert renders using the card template specified by cert_types.card_design:
 *   'aha'          → AHACertCard (grayscale + Expired badge)
 *   'superherocpr' → SuperheroCPRCertCard (grayscale + Expired badge)
 * Collapsed by default. Returns null if no expired certs exist.
 * Used by: app/(public)/dashboard/certifications/page.tsx
 */

import AHACertCard from "./AHACertCard";
import SuperheroCPRCertCard from "./SuperheroCPRCertCard";
import type { CertificationRecord } from "@/types/certifications";

interface ExpiredCertificationsListProps {
  certifications: CertificationRecord[];
  /** Full name of the student — passed through to AHACertCard for display on the card. */
  studentName: string;
}

/** Renders a collapsible list of expired certifications as eCards. Returns null if empty. */
export default function ExpiredCertificationsList({
  certifications,
  studentName,
}: ExpiredCertificationsListProps) {
  if (certifications.length === 0) return null;

  return (
    <section>
      <details className="bg-white border border-gray-200 rounded-lg">
        <summary className="px-4 py-3 text-sm font-semibold text-gray-500 cursor-pointer select-none list-none flex items-center justify-between hover:bg-gray-50 rounded-lg transition-colors duration-150">
          <span>Expired Certifications ({certifications.length})</span>
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </summary>
        <div className="flex flex-col gap-4 border-t border-gray-100 p-4">
          {certifications.map((cert) => (
            cert.cert_types.card_design === "superherocpr" ? (
              <SuperheroCPRCertCard
                key={cert.id}
                cert={cert}
                studentName={studentName}
                isExpired
              />
            ) : (
              <AHACertCard
                key={cert.id}
                cert={cert}
                studentName={studentName}
                isExpired
              />
            )
          ))}
        </div>
      </details>
    </section>
  );
}

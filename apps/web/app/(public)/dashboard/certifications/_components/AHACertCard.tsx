/**
 * AHACertCard — renders a single certification as an AHA eCard-style visual card.
 * Matches the layout and branding of official AHA eCards: cert-specific colored
 * header bar, program name, AHA logo, student name, completion statement, and
 * a three-column credential data row (Issue Date, Renew By, eCard Code).
 *
 * Color, category header, and display name are all derived via getCertConfig()
 * in lib/cert-utils.ts — do not pass raw color values from call sites.
 *
 * The isExpired variant renders the same card in grayscale with reduced opacity
 * and an "Expired" badge overlay, keeping the visual familiar while signaling
 * that the cert is no longer valid.
 *
 * Used by: ActiveCertificationsList.tsx, ExpiredCertificationsList.tsx
 */

import Image from "next/image";
import { formatCertificationDate, getCertConfig } from "@/lib/cert-utils";
import type { CertificationRecord } from "@/types/certifications";

interface AHACertCardProps {
  cert: CertificationRecord;
  /** Full name of the student who earned this certification. */
  studentName: string;
  /**
   * When true, renders the card in grayscale with reduced opacity and an
   * "Expired" badge overlay to signal the cert is no longer valid.
   */
  isExpired?: boolean;
}

/** Renders a single certification as an AHA eCard-style display card. */
export default function AHACertCard({
  cert,
  studentName,
  isExpired = false,
}: AHACertCardProps) {
  const { category, color, displayName, nameLine1, nameLine2 } = getCertConfig(cert.cert_types.name);

  const card = (
    <article
      className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm w-full"
      aria-label={`${displayName} certification card`}
    >
      {/* Colored header bar — cert-specific AHA brand color with decorative flanking lines */}
      <div
        className="px-6 py-[17px] flex items-center justify-center gap-3"
        style={{ backgroundColor: color }}
      >
        <span className="text-white font-bold text-4xl tracking-[0.08em] uppercase whitespace-nowrap">
          {category}
        </span>
      </div>

      {/* Card body */}
      <div className="px-6 pt-5 pb-4">
        {/* Program name left, AHA logo right — matching physical AHA eCard layout */}
        <div className="flex items-center justify-between gap-6">
          <div style={{ color }}>
            <p className="text-4xl font-bold leading-tight">{nameLine1}</p>
            <p className="text-4xl font-bold leading-tight">{nameLine2}</p>
          </div>
          <div className="shrink-0" style={{ marginTop: '-10px' }}>
            <Image
              src="/images/aha_full.svg"
              alt="American Heart Association"
              width={187}
              height={112}
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* Student name + completion statement */}
        <div className="mt-5 text-center px-2">
          <p className="font-bold text-gray-900 text-2xl tracking-wide">
            {studentName || "\u00A0"}{/* nbsp prevents collapse when name is empty */}
          </p>
          <p className="mt-1.5 text-base font-semibold text-gray-900 leading-relaxed">
            has successfully completed the cognitive and skills<br />
            evaluations in accordance with the curriculum of the<br />
            American Heart Association <span className="italic">{displayName}</span> Program
          </p>
        </div>

        {/* Three-column credential row */}
        <div className="mt-5 grid grid-cols-3 divide-x divide-gray-200 border-t border-gray-200 pt-4">
          <div className="text-center px-2">
            <p className="text-sm font-bold text-gray-900">
              Issue Date
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {formatCertificationDate(cert.issued_at)}
            </p>
          </div>
          <div className="text-center px-2">
            <p className="text-sm font-bold text-gray-900">
              Renew By
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {formatCertificationDate(cert.expires_at)}
            </p>
          </div>
          <div className="text-center px-2">
            <p className="text-sm font-bold text-gray-900">
              eCard Code
            </p>
            {/* cert_number is nullable — show em dash when not yet assigned */}
            <p className="mt-1 text-sm text-gray-700">
              {cert.cert_number ?? "—"}
            </p>
          </div>
        </div>

        {/* AHA verification footer */}
        <p className="mt-4 text-[10px] text-gray-400 text-center leading-snug border-t border-gray-50 pt-3">
          To view or verify authenticity, students and employers should go to{" "}
          <span className="font-medium">www.heart.org/cpr/mycards</span>
        </p>
      </div>
    </article>
  );

  if (isExpired) {
    return (
      <div className="relative">
        {/* Grayscale + opacity applied to the whole card to signal invalid status */}
        <div className="grayscale opacity-60">{card}</div>
        {/* Badge sits just below the colored header bar (top ~44px) */}
        <div className="absolute top-11 right-3">
          <span className="bg-gray-700 text-white text-[10px] font-semibold px-2 py-0.5 rounded-sm tracking-wide uppercase">
            Expired
          </span>
        </div>
      </div>
    );
  }

  return card;
}

/**
 * SuperheroCPRCertCard — SuperHero CPR branded certification card.
 * A dark-themed alternative to the AHA eCard, used for certifications
 * issued directly by SuperHero CPR rather than through the AHA.
 *
 * Layout: black card, red accent bar at top, text logo left, couple hero
 * image anchored to the right side, class name prominently centered,
 * student name + completion text, issue/valid-through date row at bottom.
 *
 * The class name shown on the card is taken from the linked booking session
 * (cert.class_sessions.class_types.name) when available, falling back to
 * the cert_types.name with any trailing " Certificate" suffix stripped.
 * This ensures the card reflects the actual class the student attended.
 *
 * The isExpired variant renders the card in grayscale with an "Expired"
 * badge overlay — same visual convention used by AHACertCard.
 *
 * Used by: ActiveCertificationsList.tsx, ExpiredCertificationsList.tsx
 */

import Image from "next/image";
import { formatCertificationDate } from "@/lib/cert-utils";
import type { CertificationRecord } from "@/types/certifications";

interface SuperheroCPRCertCardProps {
  cert: CertificationRecord;
  /** Full name of the student displayed on the card. */
  studentName: string;
  /**
   * When true, renders the card in grayscale with an "Expired" badge overlay.
   * The layout is otherwise identical to the active state.
   */
  isExpired?: boolean;
}

/**
 * Derives the class name to display on the card.
 * Prefers the class_types.name from the linked booking session (the actual
 * class the student attended). If the cert was issued manually without a
 * session, falls back to the cert_types.name with trailing cert-label words
 * removed so only the course name remains.
 * @param cert - The certification record
 */
function resolveClassName(cert: CertificationRecord): string {
  if (cert.class_sessions?.class_types.name) {
    return cert.class_sessions.class_types.name;
  }
  // Strip common suffixes used in cert type names but not in class names
  return cert.cert_types.name
    .replace(/ certificate$/i, "")
    .replace(/ cert$/i, "")
    .trim();
}

/** Renders a single SuperHero CPR branded certification card. */
export default function SuperheroCPRCertCard({
  cert,
  studentName,
  isExpired = false,
}: SuperheroCPRCertCardProps) {
  const className = resolveClassName(cert);

  const card = (
    <article
      className="relative overflow-hidden rounded-lg w-full shadow-lg"
      style={{ backgroundColor: "#111111", minHeight: "280px" }}
      aria-label={`${className} SuperHero CPR certification card`}
    >
      {/* Red accent stripe — matches the brand's primary red */}
      <div className="h-2 w-full" style={{ backgroundColor: "#CC1122" }} />

      {/* Couple hero image — anchored to the right edge, full card height.
          The image has a transparent background so the black silhouettes
          blend with the card and the gold suit accents glow against the dark. */}
      <div className="absolute right-0 bottom-0 top-2 w-[42%]">
        <Image
          src="/images/SuperHeroCPRLogo(Adjusted).png"
          alt=""
          fill
          className="object-contain object-bottom"
          aria-hidden="true"
          sizes="(max-width: 768px) 40vw, 240px"
        />
      </div>

      {/* Content — floated left so text doesn't overlap the hero image */}
      <div className="relative px-6 pb-5 pt-4 pr-[44%]">

        {/* Text logo: "SuperHero" in white + "CPR" in red.
            Italic bold approximates the hand-lettered brand style. */}
        <div className="flex items-baseline gap-0.5 leading-none">
          <span
            className="text-2xl font-black italic tracking-tight text-white"
            aria-hidden="true"
          >
            SuperHero
          </span>
          <span
            className="text-2xl font-black italic tracking-tight"
            style={{ color: "#CC1122" }}
            aria-hidden="true"
          >
            CPR
          </span>
          {/* Screen-reader label for the logo text */}
          <span className="sr-only">SuperHero CPR</span>
        </div>

        {/* Gold divider */}
        <div className="mt-3 h-px" style={{ backgroundColor: "#F59E0B" }} />

        {/* Class name — the most prominent element on the card */}
        <p
          className="mt-4 text-[1.6rem] font-extrabold uppercase leading-tight tracking-wide"
          style={{ color: "#FBBF24" }}
        >
          {className}
        </p>

        {/* Student name */}
        <p className="mt-4 text-lg font-bold tracking-wide text-white">
          {studentName || "\u00A0"}{/* nbsp prevents height collapse */}
        </p>

        {/* Completion statement */}
        <p className="mt-1 text-xs leading-snug text-gray-400">
          has successfully completed the{" "}
          <span className="font-medium text-gray-300">{className}</span> course
        </p>

        {/* Faint gold rule before dates */}
        <div className="mt-4 h-px" style={{ backgroundColor: "#78350F" }} />

        {/* Date row */}
        <div className="mt-3 flex gap-8">
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "#F59E0B" }}
            >
              Issue Date
            </p>
            <p className="mt-0.5 text-sm font-medium text-white">
              {formatCertificationDate(cert.issued_at)}
            </p>
          </div>
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "#F59E0B" }}
            >
              Valid Through
            </p>
            <p className="mt-0.5 text-sm font-medium text-white">
              {formatCertificationDate(cert.expires_at)}
            </p>
          </div>
        </div>

      </div>
    </article>
  );

  if (isExpired) {
    return (
      <div className="relative">
        {/* Grayscale + opacity signal that the cert is no longer valid */}
        <div className="grayscale opacity-60">{card}</div>
        {/* Expired badge sits just below the red stripe */}
        <div className="absolute top-4 right-3">
          <span className="rounded-sm bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Expired
          </span>
        </div>
      </div>
    );
  }

  return card;
}

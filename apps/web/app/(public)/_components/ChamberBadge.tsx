/**
 * ChamberBadge — server-rendered Manatee Chamber of Commerce membership badge.
 * Fetches the chamber's public widget payload on the server and renders plain
 * HTML so the footer does not depend on a third-party browser script.
 * Used by: PublicFooter
 */

import Image from "next/image";

const BADGE_URL =
  "https://manateechamber.chambermaster.com/public/widgets/member?memId=42270&secure=true&referrer=superherocpr.com&jsonpcallback=chamberBadgeCallback";
const FALLBACK_ASSOCIATION_URL = "https://manateechamber.com/";

interface ChamberBadgeData {
  Customer: string;
  Logo: string;
  URL: string;
  Member: string;
}

/**
 * Parses ChamberMaster's JSONP response into a typed badge payload.
 * @param payload - Raw response body returned by the public widget endpoint.
 * @returns Parsed badge data when the payload is valid JSONP, otherwise null.
 */
function parseBadgePayload(payload: string): ChamberBadgeData | null {
  const match = payload.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as Partial<ChamberBadgeData>;

    if (
      typeof parsed.Customer !== "string" ||
      typeof parsed.Logo !== "string" ||
      typeof parsed.URL !== "string" ||
      typeof parsed.Member !== "string"
    ) {
      return null;
    }

    return parsed as ChamberBadgeData;
  } catch {
    return null;
  }
}

/**
 * Normalizes association links to HTTPS before rendering them in the footer.
 * @param url - Chamber-provided association URL.
 * @returns The HTTPS-normalized URL.
 */
function normalizeBadgeUrl(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

/**
 * Fetches the public chamber badge data for SuperHeroCPR.
 * @returns The parsed public badge payload, or null when the request fails.
 */
async function getChamberBadgeData(): Promise<ChamberBadgeData | null> {
  const response = await fetch(BADGE_URL, {
    next: { revalidate: 86400 },
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const payload = await response.text();
  return parseBadgePayload(payload);
}

/**
 * Renders a footer-friendly chamber membership badge without client-side JS.
 * @returns The rendered chamber badge with the public logo and association link.
 */
export async function ChamberBadge() {
  const badge = await getChamberBadgeData();
  const associationName = badge?.Customer ?? "Manatee Chamber of Commerce";
  const associationUrl = normalizeBadgeUrl(
    badge?.URL ?? FALLBACK_ASSOCIATION_URL
  );

  return (
    <a
      href={associationUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex flex-col items-start gap-2 rounded-md hover:opacity-90 transition-opacity duration-150"
      aria-label={`View SuperHeroCPR membership with ${associationName}`}
    >
      <span className="text-sm font-semibold text-white leading-none">
        Proud Member of
      </span>

      {badge ? (
        <>
          {/* ChamberMaster returns the official association logo via its public widget payload. */}
          <Image
            src={badge.Logo}
            alt={associationName}
            width={96}
            height={96}
            className="h-16 w-auto object-contain"
          />
          <span className="text-xs text-gray-300 leading-relaxed">
            {badge.Member}
          </span>
        </>
      ) : (
        <span className="text-sm text-gray-300 leading-relaxed">
          {associationName}
        </span>
      )}
    </a>
  );
}

/**
 * ExpiredCertificationsList — collapsible section of expired certifications.
 * Collapsed by default. Returns null if no expired certs exist.
 * Used by: app/(public)/dashboard/certifications/page.tsx
 */

import type { CertificationRecord } from "@/types/certifications";

interface ExpiredCertificationsListProps {
  certifications: CertificationRecord[];
}

/** Formats a date string to a short readable label: "April 1, 2024". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Renders a collapsible list of expired certifications. Returns null if empty. */
export default function ExpiredCertificationsList({
  certifications,
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
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {certifications.map((cert) => (
            <div key={cert.id} className="px-4 py-3 flex flex-col gap-0.5">
              <p className="font-semibold text-sm text-gray-700">
                {cert.cert_types.name}
              </p>
              <p className="text-xs text-gray-500">
                Cert #{cert.cert_number}
              </p>
              <p className="text-xs text-gray-400">
                Expired {formatDate(cert.expires_at)}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

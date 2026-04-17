/**
 * ActiveCertificationsList — shows all active/expiring-soon certifications as full cards.
 * Left border color reflects cert status: green = valid, amber = expiring soon.
 * Each card includes cert number, issued date, expiry date, status badge, and renewal CTA.
 * Renders an empty state with "Book a Class" CTA if the customer has no active certs.
 * Used by: app/(public)/dashboard/certifications/page.tsx
 */

import Link from "next/link";
import { Award, AlertCircle } from "lucide-react";
import { getCertStatus } from "@/lib/cert-utils";
import type { CertificationRecord } from "@/types/certifications";

interface ActiveCertificationsListProps {
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

const statusBadgeClasses = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
};

const cardBorderClasses = {
  green: "border-l-4 border-l-green-400",
  amber: "border-l-4 border-l-amber-400",
  red: "border-l-4 border-l-red-400",
};

/** Renders full certification cards for all active certs, or an empty state with CTA. */
export default function ActiveCertificationsList({
  certifications,
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
            <article
              key={cert.id}
              className={`bg-white border border-gray-200 rounded-lg p-5 ${cardBorderClasses[status.color]}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">
                      {cert.cert_types.name}
                    </h3>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClasses[status.color]}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <p className="text-sm text-gray-500">
                    Cert #{cert.cert_number}
                  </p>
                </div>

                {status.color !== "green" && (
                  <div className="flex items-center gap-1 text-amber-600">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span className="text-xs font-medium">Renewal needed</span>
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                    Issued
                  </p>
                  <p className="text-gray-700 mt-0.5">
                    {formatDate(cert.issued_at)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                    Expires
                  </p>
                  <p
                    className={
                      status.color === "green"
                        ? "text-gray-700 mt-0.5"
                        : "text-amber-700 font-semibold mt-0.5"
                    }
                  >
                    {formatDate(cert.expires_at)}
                  </p>
                </div>
              </div>

              {status.color !== "green" && (
                <div className="mt-4">
                  <Link
                    href="/book"
                    className="inline-block bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-150"
                  >
                    Book Renewal Class
                  </Link>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

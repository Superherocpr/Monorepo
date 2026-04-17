/**
 * CertificationsWidget — dashboard card showing the customer's certifications with expiry status.
 * Returns null if the customer has no certifications (hides the widget entirely).
 * Imports getCertStatus from lib/cert-utils.ts — do not duplicate that function here.
 * Used by: app/(public)/dashboard/page.tsx
 */

import Link from "next/link";
import { AlertTriangle, XCircle } from "lucide-react";
import { getCertStatus } from "@/lib/cert-utils";
import type { CertificationWidgetItem } from "@/types/certifications";

interface CertificationsWidgetProps {
  certifications: CertificationWidgetItem[];
}

/** Renders a card with the customer's certifications and their current expiry status. Returns null if empty. */
export default function CertificationsWidget({
  certifications,
}: CertificationsWidgetProps) {
  if (certifications.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          My Certifications
        </h2>
        <Link
          href="/dashboard/certifications"
          className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
        >
          View all
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {certifications.map((cert) => {
          const status = getCertStatus(cert.expires_at);
          return (
            <div key={cert.id} className="flex flex-col gap-0.5">
              <p className="font-semibold text-gray-900 text-sm">
                {cert.cert_types.name}
              </p>
              <p className="text-xs text-gray-500">
                Issued:{" "}
                {new Date(cert.issued_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              <span
                className={[
                  "inline-flex items-center gap-1 text-xs",
                  status.color === "green" && "text-green-600",
                  status.color === "amber" && "text-amber-600 font-medium",
                  status.color === "red" && "text-red-600 font-medium",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {status.color === "amber" && (
                  <AlertTriangle
                    size={12}
                    aria-label="Warning: certificate expiring soon"
                  />
                )}
                {status.color === "red" && (
                  <XCircle
                    size={12}
                    aria-label="Certificate expired"
                  />
                )}
                {status.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

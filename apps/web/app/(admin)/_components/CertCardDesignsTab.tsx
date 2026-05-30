"use client";

/**
 * CertCardDesignsTab — static preview of every cert card design used in the platform.
 * Renders one card per AHA cert type (from CERT_CONFIGS) plus the SuperHero CPR
 * branded card design. All cards use mock data — no DB queries or API calls.
 *
 * Used by: CertificationsClient.tsx (Card Designs tab)
 */

import { CERT_CONFIGS } from "@/lib/cert-utils";
import AHACertCard from "@/app/(public)/dashboard/certifications/_components/AHACertCard";
import SuperheroCPRCertCard from "@/app/(public)/dashboard/certifications/_components/SuperheroCPRCertCard";
import type { CertificationRecord } from "@/types/certifications";

/**
 * Builds a mock CertificationRecord for AHA eCard preview rendering.
 * The id is a non-UUID string so any accidental API calls will fail cleanly
 * without matching a real record.
 * @param certTypeName - The cert_types.name value (key from CERT_CONFIGS)
 */
function mockAHACert(certTypeName: string): CertificationRecord {
  return {
    id: `preview-${certTypeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    issued_at: "2025-01-15",
    expires_at: "2027-01-15",
    cert_number: "XXXX-XXXX",
    notes: null,
    cert_types: {
      name: certTypeName,
      issuing_body: "American Heart Association",
      validity_months: 24,
    },
    class_sessions: null,
  };
}

/**
 * Builds a mock CertificationRecord for SuperHero CPR card preview.
 * @param className - The class name to display prominently on the card.
 */
function mockSHCPRCert(className: string): CertificationRecord {
  return {
    id: `preview-shcpr-${className.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    issued_at: "2025-01-15",
    expires_at: "2027-01-15",
    cert_number: null,
    notes: null,
    cert_types: {
      name: `${className} Certificate`,
      issuing_body: "SuperHero CPR",
      validity_months: 24,
    },
    class_sessions: {
      starts_at: "2025-01-15T14:00:00.000Z",
      class_types: { name: className },
    },
  };
}

/** Renders a read-only preview of every cert card design used in the platform. */
export default function CertCardDesignsTab() {
  const certNames = Object.keys(CERT_CONFIGS);

  return (
    <div>
      {/* ── SuperHero CPR card design ─────────────────────────────────────── */}
      <div className="mb-10">
        <h2 className="text-lg font-semibold text-gray-900">Card Designs</h2>
        <p className="mt-1 mb-6 text-sm text-gray-500">
          Preview of every cert card style used on the platform.
        </p>

        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          SuperHero CPR Cards
        </h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {/* Active variant */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Active — CPR Awareness
            </p>
            <div style={{ zoom: 0.65 }}>
              <SuperheroCPRCertCard
                cert={mockSHCPRCert("CPR Awareness")}
                studentName="Jane Doe"
              />
            </div>
          </div>

          {/* Expired variant */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Expired — CPR Awareness
            </p>
            <div style={{ zoom: 0.65 }}>
              <SuperheroCPRCertCard
                cert={mockSHCPRCert("CPR Awareness")}
                studentName="Jane Doe"
                isExpired
              />
            </div>
          </div>

          {/* Long class name test */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Long class name
            </p>
            <div style={{ zoom: 0.65 }}>
              <SuperheroCPRCertCard
                cert={mockSHCPRCert("Pediatric First Aid & CPR")}
                studentName="Jane Doe"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── AHA eCard designs ─────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
          AHA eCards
        </h3>
        <p className="mb-6 text-xs text-gray-400">
          Colors and labels are driven by{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">CERT_CONFIGS</code> in{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">lib/cert-utils.ts</code>.
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {certNames.map((name) => (
            <div key={name}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {name}
              </p>
              <div style={{ zoom: 0.65 }}>
                <AHACertCard cert={mockAHACert(name)} studentName="Jane Doe" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

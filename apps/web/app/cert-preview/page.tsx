// TODO: Remove this page before launch — development preview only.
// Shows all AHA eCard cert types with mock data so the design can be reviewed
// without needing real database records.
// Access at: /cert-preview

import AHACertCard from "@/app/(public)/dashboard/certifications/_components/AHACertCard";
import type { CertificationRecord } from "@/types/certifications";

/**
 * Builds a mock CertificationRecord for preview purposes.
 * @param certName - The exact cert_types.name value as stored in the DB
 * @param certNumber - A fake eCard code to display
 * @param issuedOffset - Days offset from today for issued_at (negative = past)
 * @param expiresOffset - Days offset from today for expires_at (positive = future, negative = past)
 */
function mockCert(
  certName: string,
  certNumber: string,
  issuedOffset: number,
  expiresOffset: number
): CertificationRecord {
  const now = new Date();
  const issued = new Date(now);
  issued.setDate(issued.getDate() + issuedOffset);
  const expires = new Date(now);
  expires.setDate(expires.getDate() + expiresOffset);

  return {
    id: certName,
    issued_at: issued.toISOString().split("T")[0],
    expires_at: expires.toISOString().split("T")[0],
    cert_number: certNumber,
    notes: null,
    cert_types: {
      name: certName,
      issuing_body: "American Heart Association",
      validity_months: 24,
    },
    class_sessions: null,
  };
}

/** All 13 AHA cert types used in this system, grouped by color family. */
const PREVIEW_CERTS: CertificationRecord[] = [
  // Navy — Heartsaver family
  mockCert("Heartsaver® First Aid eCard",                  "HS-FA-001234", -180, 545),
  mockCert("Heartsaver® CPR AED eCard",                    "HS-CA-002345", -90,  635),
  mockCert("Heartsaver® First Aid CPR AED eCard",          "HS-FC-003456", -30,  695),
  mockCert("Heartsaver® Pediatric First Aid CPR AED eCard","HS-PF-004567", -10,  715),
  mockCert("Heartsaver® Instructor eCard",                 "HS-IN-005678", -60,  665),
  // Blue — BLS family
  mockCert("Advisor: BLS eCard",                           "BL-AD-006789", -120, 605),
  mockCert("BLS Provider eCard",                           "BL-PR-007890", -200, 525),
  mockCert("BLS Instructor eCard",                         "BL-IN-008901", -45,  680),
  // Red — ACLS family
  mockCert("ACLS Provider eCard",                          "AC-PR-009012", -150, 575),
  mockCert("ACLS Instructor eCard",                        "AC-IN-010123", -75,  650),
  // Purple — PALS family
  mockCert("PALS Provider eCard",                          "PA-PR-011234", -100, 625),
  mockCert("PALS Instructor eCard",                        "PA-IN-012345", -20,  705),
  // Green — K-12
  mockCert("Heartsaver® for K-12 Schools eCard",           "K12-013456",   -50,  675),
];

/** One expired cert for testing the grayscale/badge expired variant. */
const EXPIRED_CERT: CertificationRecord = mockCert(
  "BLS Provider eCard",
  "BL-PR-EXP-999",
  -800,
  -70
);

/** /cert-preview — Development-only page for reviewing AHA eCard designs visually. */
export default function CertPreviewPage() {
  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4">
      {/* Page header */}
      <div className="max-w-3xl mx-auto mb-8">
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 flex items-center gap-2">
          <span className="text-amber-700 font-semibold text-sm">
            Dev Preview
          </span>
          <span className="text-amber-600 text-sm">
            — This page shows all AHA eCard types with mock data. Remove before launch.
          </span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          AHA eCard Certificate Preview
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          All 13 cert types · Mock student: Jane Smith · One expired variant at the bottom
        </p>
      </div>

      {/* All active cert types */}
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        {PREVIEW_CERTS.map((cert) => (
          <AHACertCard
            key={cert.id}
            cert={cert}
            studentName="Jane Smith"
          />
        ))}

        {/* Expired variant section */}
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Expired variant (grayscale treatment)
          </p>
          <AHACertCard
            cert={EXPIRED_CERT}
            studentName="Jane Smith"
            isExpired
          />
        </div>

        {/* Empty name edge case */}
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Edge case — no cert_number, no student name
          </p>
          <AHACertCard
            cert={{ ...PREVIEW_CERTS[0], cert_number: null }}
            studentName=""
          />
        </div>
      </div>
    </div>
  );
}

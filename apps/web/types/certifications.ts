/**
 * TypeScript interfaces for certification database tables.
 * Covers: cert_types, certifications.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A certification type from the `cert_types` table.
 * e.g. BLS, Heartsaver, CPR+AED, Pediatric CPR.
 */
export interface CertType {
  id: string;
  name: string;
  description: string | null;
  validity_months: number;
  issuing_body: string | null;
  active: boolean;
  created_at: string;
}

/**
 * A customer's earned certification from the `certifications` table.
 * session_id is nullable — cert may be entered manually without a session.
 */
export interface Certification {
  id: string;
  customer_id: string;
  cert_type_id: string;
  session_id: string | null;
  issued_at: string;
  expires_at: string;
  cert_number: string | null;
  reminder_sent: boolean;
  notes: string | null;
  created_at: string;
}

/**
 * A certification with its cert_type joined in.
 * Used on the customer dashboard certifications page.
 */
export interface CertificationWithType extends Certification {
  cert_types: CertType;
}

/**
 * A certification with all related data joined in, as returned by the
 * certifications dashboard page query. Includes cert_types and the originating
 * class session (nullable — certs may be manually issued without a session).
 */
export interface CertificationRecord {
  id: string;
  issued_at: string;
  expires_at: string;
  cert_number: string | null;
  notes: string | null;
  cert_types: {
    name: string;
    issuing_body: string | null;
    validity_months: number;
  };
  class_sessions: {
    starts_at: string;
    class_types: { name: string };
  } | null;
}

/**
 * Minimal cert shape used in the dashboard certifications widget.
 */
export interface CertificationWidgetItem {
  id: string;
  issued_at: string;
  expires_at: string;
  cert_number: string | null;
  cert_types: { name: string };
}

/**
 * TypeScript interfaces for roster/grading database tables.
 * Covers: roster_records, roster_uploads, preset_grades.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A student record on a class roster from the `roster_records` table.
 * May be created via roster import or walk-in rollcall registration.
 */
export interface RosterRecord {
  id: string;
  session_id: string;
  booking_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  grade: number | null;
  confirmed: boolean;
  corrected: boolean;
  device_token: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A customer-submitted roster spreadsheet from the `roster_uploads` table.
 * Awaits manager import. file_url points to an AWS S3 object.
 */
export interface RosterUpload {
  id: string;
  invoice_id: string;
  session_id: string;
  file_url: string;
  original_filename: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  imported: boolean;
  created_at: string;
}

/**
 * A selectable grade value from the `preset_grades` table.
 * Shown in the instructor grading tool. e.g. { value: 100, label: "Pass" }.
 */
export interface PresetGrade {
  id: string;
  value: number;
  label: string;
  created_at: string;
}

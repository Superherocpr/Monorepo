/**
 * TypeScript interfaces for contact form database tables.
 * Covers: contact_submissions, contact_replies.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/**
 * A contact form submission from the `contact_submissions` table.
 */
export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  inquiry_type: string;
  message: string;
  replied: boolean;
  created_at: string;
}

/**
 * A staff reply to a contact submission from the `contact_replies` table.
 * Sent via Zoho Mail. zoho_message_id enables thread linking.
 */
export interface ContactReply {
  id: string;
  submission_id: string;
  sent_by: string;
  subject: string;
  body: string;
  zoho_message_id: string | null;
  has_attachments: boolean;
  created_at: string;
}

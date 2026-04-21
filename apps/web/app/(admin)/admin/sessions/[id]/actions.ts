"use server";

/**
 * Server actions for the admin session detail page (/admin/sessions/[id]).
 * Handles approve, reject, cancel, and edit mutations on class_sessions.
 * All successful mutations revalidate the session detail and list paths.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Approves a class session by setting approval_status to 'approved'.
 * @param sessionId - UUID of the class_sessions record to approve.
 * @returns An error message string on failure, or null on success.
 * TODO: Send approval notification email to the instructor via Resend.
 */
export async function approveSession(sessionId: string): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({ approval_status: "approved" })
    .eq("id", sessionId);
  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return null;
}

/**
 * Rejects a class session by setting approval_status to 'rejected' and storing the reason.
 * @param sessionId - UUID of the class_sessions record to reject.
 * @param reason - The rejection reason shown to the instructor. Must be at least 10 characters.
 * @returns An error message string on failure, or null on success.
 * TODO: Send rejection email to the instructor via Resend.
 */
export async function rejectSession(
  sessionId: string,
  reason: string
): Promise<string | null> {
  if (reason.trim().length < 10) {
    return "Rejection reason must be at least 10 characters.";
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({
      approval_status: "rejected",
      rejection_reason: reason.trim(),
    })
    .eq("id", sessionId);
  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return null;
}

/**
 * Cancels a class session. Sets status to 'cancelled' and stores the reason in notes.
 * @param sessionId - UUID of the class_sessions record to cancel.
 * @param reason - Cancellation reason stored in the session notes. Must be at least 10 characters.
 * @returns An error message string on failure, or null on success.
 * TODO: Send cancellation notification email to all booked students via Resend.
 */
export async function cancelSession(
  sessionId: string,
  reason: string
): Promise<string | null> {
  if (reason.trim().length < 10) {
    return "Cancellation reason must be at least 10 characters.";
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("class_sessions")
    .update({
      status: "cancelled",
      notes: reason.trim(),
    })
    .eq("id", sessionId);
  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return null;
}

/** Shape of the editable fields on a class session. */
export interface SessionEditFields {
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  /** ISO datetime string (datetime-local input value). Stored as-is; timezone is UTC. */
  starts_at: string;
  /** ISO datetime string (datetime-local input value). Stored as-is; timezone is UTC. */
  ends_at: string;
  max_capacity: number;
  notes: string;
}

/**
 * Updates editable fields on a class session.
 * If the session was previously approved, resets approval_status to 'pending_approval'
 * so the session must be re-reviewed before returning to the public schedule.
 * @param sessionId - UUID of the class_sessions record to update.
 * @param fields - The fields to update.
 * @param wasApproved - Pass true if the session's current approval_status is 'approved'.
 * @returns An error message string on failure, or null on success.
 */
export async function updateSession(
  sessionId: string,
  fields: SessionEditFields,
  wasApproved: boolean
): Promise<string | null> {
  const supabase = await createClient();

  const update: Record<string, unknown> = {
    class_type_id: fields.class_type_id,
    instructor_id: fields.instructor_id,
    location_id: fields.location_id,
    starts_at: fields.starts_at,
    ends_at: fields.ends_at,
    max_capacity: fields.max_capacity,
    notes: fields.notes || null,
  };

  // Editing an approved session removes it from the public schedule until re-approved
  if (wasApproved) {
    update.approval_status = "pending_approval";
  }

  const { error } = await supabase
    .from("class_sessions")
    .update(update)
    .eq("id", sessionId);
  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return null;
}

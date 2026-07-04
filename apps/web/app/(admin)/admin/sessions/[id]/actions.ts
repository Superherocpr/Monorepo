"use server";

/**
 * Server actions for the admin session detail page (/admin/sessions/[id]).
 * Handles approve, reject, cancel, and edit mutations on class_sessions.
 * All successful mutations revalidate the session detail and list paths.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor, type AdminActor } from "@/lib/auth/effective-role";
import type { UserRole } from "@/types/users";

/**
 * Auth guard for these server actions. Server actions are network-invocable
 * endpoints, so every mutation below must verify identity and role itself —
 * the page-level guard does not protect direct invocations.
 * Checks the EFFECTIVE role, so view-as is honored.
 * @param allowed - Roles permitted to run the action.
 * @returns The actor on success, or an error string matching the actions' return contract.
 */
async function requireActionRole(
  allowed: UserRole[]
): Promise<{ actor: AdminActor } | { error: string }> {
  const actor = await getAdminActor();
  if (!actor) return { error: "You must be signed in." };
  if (!allowed.includes(actor.effectiveRole)) {
    return { error: "You do not have permission to perform this action." };
  }
  return { actor };
}

/**
 * Approves a class session by setting approval_status to 'approved'.
 * Auth: manager and super_admin only.
 * @param sessionId - UUID of the class_sessions record to approve.
 * @returns An error message string on failure, or null on success.
 * TODO: Send approval notification email to the instructor via Resend.
 */
export async function approveSession(sessionId: string): Promise<string | null> {
  const auth = await requireActionRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const admin = await createAdminClient();
  const { error } = await admin
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
  const auth = await requireActionRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const admin = await createAdminClient();
  const { error } = await admin
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
  const auth = await requireActionRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const admin = await createAdminClient();
  const { error } = await admin
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

/**
 * Approves multiple class sessions in a single batch update.
 * Used by the inline "Approve All" action on the approvals queue page.
 * @param sessionIds - Array of class_sessions UUIDs to approve.
 * @returns An error message string on failure, or null on success.
 * TODO: Send approval notification emails to each instructor via Resend.
 */
export async function bulkApproveSession(sessionIds: string[]): Promise<string | null> {
  if (sessionIds.length === 0) return null;
  const auth = await requireActionRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const admin = await createAdminClient();
  const { error } = await admin
    .from("class_sessions")
    .update({ approval_status: "approved" })
    .in("id", sessionIds);
  if (error) return error.message;
  revalidatePath("/admin/sessions/approvals");
  revalidatePath("/admin/sessions");
  return null;
}

/** Shape of the editable fields on a class session. */
export interface SessionEditFields {
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  /** UTC ISO datetime string. Client converts datetime-local (local time) to UTC before passing here. */
  starts_at: string;
  /** UTC ISO datetime string. Client converts datetime-local (local time) to UTC before passing here. */
  ends_at: string;
  max_capacity: number;
  /** Promotional discount as a percentage (0–50). Null = no discount. */
  discount_percent: number | null;
  notes: string;
}

/**
 * Updates editable fields on a class session.
 * If the session was previously approved, resets approval_status to 'pending_approval'
 * so the session must be re-reviewed before returning to the public schedule.
 * Auth: manager/super_admin for any session; instructors only for their own
 * not-yet-approved sessions, and they may not reassign the instructor.
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
  const auth = await requireActionRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;
  const { actor } = auth;

  const admin = await createAdminClient();

  // Instructor constraints — mirror the UI's canEdit logic server-side:
  // own session only, not yet approved, and no reassigning to someone else.
  if (actor.effectiveRole === "instructor") {
    const { data: current } = await admin
      .from("class_sessions")
      .select("instructor_id, approval_status")
      .eq("id", sessionId)
      .single();
    if (!current || current.instructor_id !== actor.user.id) {
      return "You may only edit your own sessions.";
    }
    if (current.approval_status === "approved") {
      return "Approved sessions can only be edited by a manager.";
    }
    if (fields.instructor_id !== actor.user.id) {
      return "You may not reassign this session to another instructor.";
    }
  }

  const update: Record<string, unknown> = {
    class_type_id: fields.class_type_id,
    instructor_id: fields.instructor_id,
    location_id: fields.location_id,
    starts_at: fields.starts_at,
    ends_at: fields.ends_at,
    max_capacity: fields.max_capacity,
    discount_percent: fields.discount_percent,
    notes: fields.notes || null,
  };

  // Editing an approved session removes it from the public schedule until re-approved
  if (wasApproved) {
    update.approval_status = "pending_approval";
  }

  const { error } = await admin
    .from("class_sessions")
    .update(update)
    .eq("id", sessionId);
  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  return null;
}

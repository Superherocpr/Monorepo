"use server";

/**
 * Server actions for the admin session detail page (/admin/sessions/[id]).
 * Handles approve, reject, and edit mutations on class_sessions.
 * (Cancel/claim moved to POST /api/sessions/[id]/cancel and /claim — those need
 * to send emails from a route context and be callable by instructors too.)
 * All successful mutations revalidate the session detail and list paths.
 */

import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor, type AdminActor } from "@/lib/auth/effective-role";
import { bookingCancelledEmail } from "@/lib/emails";
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
  // Revalidate public pages so the newly approved session appears immediately
  revalidatePath("/book");
  revalidatePath("/");
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
  // Revalidate public pages in case the session was previously approved
  revalidatePath("/book");
  revalidatePath("/");
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
  // Revalidate public pages so newly approved sessions appear immediately
  revalidatePath("/book");
  revalidatePath("/");
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
  // If approval was reset, remove the session from public pages immediately
  if (wasApproved) {
    revalidatePath("/book");
    revalidatePath("/");
  }
  return null;
}

/**
 * Assigns or clears the documentation-only class assistant on a session.
 * Exactly one of instructorId/name may be set (or both null to clear).
 * Not gated on approval status or the 9-student threshold — staff can add
 * an assistant at any time. Does not affect payout in any way.
 * Auth: manager/super_admin for any session; instructors only for their own.
 * @param sessionId - UUID of the class_sessions record to update.
 * @param assistant - Either a platform instructor id, a free-text name, or both null to clear.
 * @returns An error message string on failure, or null on success.
 */
export async function setSessionAssistant(
  sessionId: string,
  assistant: { instructorId: string | null; name: string | null }
): Promise<string | null> {
  if (assistant.instructorId && assistant.name) {
    return "An assistant may be a platform instructor or a name, not both.";
  }

  const auth = await requireActionRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;
  const { actor } = auth;

  const admin = await createAdminClient();

  if (actor.effectiveRole === "instructor") {
    const { data: current } = await admin
      .from("class_sessions")
      .select("instructor_id")
      .eq("id", sessionId)
      .single();
    if (!current || current.instructor_id !== actor.user.id) {
      return "You may only manage the assistant on your own sessions.";
    }
  }

  const trimmedName = assistant.name?.trim() || null;

  const { error } = await admin
    .from("class_sessions")
    .update({
      assistant_instructor_id: assistant.instructorId,
      assistant_name: trimmedName,
    })
    .eq("id", sessionId);
  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  return null;
}

/**
 * Cancels a single booking by setting cancelled = true, cleans up any
 * instructor earning that hasn't been paid out yet, and emails the customer.
 *
 * Earnings cleanup rules (no PayPal refund is ever issued automatically):
 *   - status "pending"        → delete the earning (never sent, money stays with company)
 *   - status "payout_pending" → if the payout batch is still "pending" (not yet sent to
 *                               PayPal), remove the earning and adjust the batch/item totals
 *                               so the money stays with the company; otherwise leave it
 *                               (instructor keeps the payout, company absorbs)
 *   - status "paid"           → leave untouched (instructor keeps payout, company absorbs)
 *
 * Verifies the booking belongs to sessionId before mutating to prevent cross-session tampering.
 * Auth: manager/super_admin only.
 * @param bookingId - UUID of the bookings record to cancel.
 * @param sessionId - UUID of the owning class_sessions record (ownership check).
 * @returns An error message string on failure, or null on success.
 */
export async function removeBookingFromSession(
  bookingId: string,
  sessionId: string
): Promise<string | null> {
  const auth = await requireActionRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const admin = await createAdminClient();

  // Fetch booking with customer profile + session class details in one query.
  // The ownership check (eq session_id) prevents cross-session tampering.
  const { data: booking } = await admin
    .from("bookings")
    .select(`
      id, session_id, cancelled,
      profiles!bookings_customer_id_fkey ( first_name, email ),
      class_sessions!bookings_session_id_fkey (
        starts_at,
        class_types ( name )
      )
    `)
    .eq("id", bookingId)
    .eq("session_id", sessionId)
    .single();

  if (!booking) return "Booking not found for this session.";
  if (booking.cancelled) return null; // already cancelled — no-op

  const { error } = await admin
    .from("bookings")
    .update({ cancelled: true })
    .eq("id", bookingId);

  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);

  // ── Instructor earnings cleanup ───────────────────────────────────────────
  // Best-effort: a failure here is logged but does not un-cancel the booking.
  // The worst outcome is an orphaned pending earning that gets paid out later;
  // a super admin can find and void it manually via the payouts dashboard.
  try {
    const { data: earning } = await admin
      .from("instructor_earnings")
      .select("id, status, instructor_amount, payout_batch_id, payout_item_id")
      .eq("booking_id", bookingId)
      .maybeSingle();

    if (earning) {
      if (earning.status === "pending") {
        // Not in any batch yet — delete the row outright.
        const { error: delErr } = await admin
          .from("instructor_earnings")
          .delete()
          .eq("id", earning.id);
        if (delErr) {
          console.error("[removeBookingFromSession] Failed to delete pending earning:", delErr, { bookingId });
        }

      } else if (
        earning.status === "payout_pending" &&
        earning.payout_batch_id &&
        earning.payout_item_id
      ) {
        // Reserved in a batch. Only remove it if the batch hasn't been sent to
        // PayPal yet — once submitted, the instructor keeps the payout.
        const { data: batch } = await admin
          .from("instructor_payout_batches")
          .select("id, status, total_amount, item_count")
          .eq("id", earning.payout_batch_id)
          .maybeSingle();

        if (batch?.status === "pending") {
          const earningAmount = Number(earning.instructor_amount);

          // Delete the earning and its attempt record.
          await admin.from("instructor_earnings").delete().eq("id", earning.id);
          await admin
            .from("instructor_payout_attempts")
            .delete()
            .eq("earning_id", earning.id)
            .eq("payout_batch_id", earning.payout_batch_id);

          // Adjust the payout item for this instructor.
          const { data: item } = await admin
            .from("instructor_payout_items")
            .select("id, amount")
            .eq("id", earning.payout_item_id)
            .maybeSingle();

          if (item) {
            const newItemAmount = Math.max(0, Number(item.amount) - earningAmount);
            const newBatchTotal = Math.max(0, Number(batch.total_amount) - earningAmount);

            if (newItemAmount <= 0) {
              // This was the instructor's only earning in the batch — remove their item.
              await admin.from("instructor_payout_items").delete().eq("id", item.id);
              const newItemCount = Math.max(0, batch.item_count - 1);
              if (newItemCount <= 0) {
                // Batch is now empty — delete it entirely.
                await admin.from("instructor_payout_batches").delete().eq("id", batch.id);
              } else {
                await admin
                  .from("instructor_payout_batches")
                  .update({ total_amount: newBatchTotal, item_count: newItemCount })
                  .eq("id", batch.id);
              }
            } else {
              // Instructor has other earnings in this batch — just reduce the amounts.
              await admin
                .from("instructor_payout_items")
                .update({ amount: newItemAmount })
                .eq("id", item.id);
              await admin
                .from("instructor_payout_batches")
                .update({ total_amount: newBatchTotal })
                .eq("id", batch.id);
            }
          }
        }
        // If batch is any other status (already sent to PayPal), leave the earning.
      }
      // If status is "paid", leave the earning — instructor keeps the payout.
    }
  } catch (earningsErr) {
    console.error("[removeBookingFromSession] Earnings cleanup error (non-fatal):", earningsErr, { bookingId });
  }

  // ── Cancellation email ────────────────────────────────────────────────────
  // Best-effort, does not affect the DB result.
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    try {
      const profile = Array.isArray(booking.profiles) ? booking.profiles[0] : booking.profiles;
      const session = Array.isArray(booking.class_sessions)
        ? booking.class_sessions[0]
        : booking.class_sessions;
      const classType = session
        ? Array.isArray(session.class_types)
          ? session.class_types[0]
          : session.class_types
        : null;

      const toEmail = profile?.email ?? null;
      const firstName = profile?.first_name ?? "there";
      const className = classType?.name ?? "CPR Class";
      const startsAt = session?.starts_at ?? new Date().toISOString();

      if (toEmail) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { subject, html } = bookingCancelledEmail({ firstName, className, startsAt });
        const { error: emailError } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: toEmail,
          subject,
          html,
        });
        if (emailError) {
          console.error("[removeBookingFromSession] Cancellation email failed:", emailError);
        }
      } else {
        console.warn("[removeBookingFromSession] Cancellation email skipped: no email on profile", { bookingId });
      }
    } catch (emailErr) {
      console.error("[removeBookingFromSession] Cancellation email threw:", emailErr);
    }
  }

  return null;
}

/**
 * Deletes a roster_record row from a session.
 * Verifies the record belongs to sessionId before deleting to prevent cross-session tampering.
 * Auth: manager/super_admin only.
 * @param recordId - UUID of the roster_records row to delete.
 * @param sessionId - UUID of the owning class_sessions record (ownership check).
 * @returns An error message string on failure, or null on success.
 */
export async function removeRosterRecordFromSession(
  recordId: string,
  sessionId: string
): Promise<string | null> {
  const auth = await requireActionRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const admin = await createAdminClient();

  // Verify ownership — prevents deleting roster records from another session.
  const { data: record } = await admin
    .from("roster_records")
    .select("id, session_id")
    .eq("id", recordId)
    .eq("session_id", sessionId)
    .single();

  if (!record) return "Roster record not found for this session.";

  const { error } = await admin
    .from("roster_records")
    .delete()
    .eq("id", recordId);

  if (error) return error.message;
  revalidatePath(`/admin/sessions/${sessionId}`);
  return null;
}

/**
 * Syncs the add-ons offered on a session (session_addons, migration 0036).
 * Replace-all: clears existing rows then inserts the submitted set — simpler
 * and safer than diffing, and this list is always small.
 * Not gated on approval status — same reasoning as the assistant assignment
 * above, it's not part of the reviewed edit fields.
 * Auth: manager/super_admin for any session; instructors only for their own.
 * @param sessionId - UUID of the class_sessions record to update.
 * @param addonIds - IDs of add-ons to offer on this session.
 * @returns An error message string on failure, or null on success.
 */
export async function setSessionAddons(
  sessionId: string,
  addonIds: string[]
): Promise<string | null> {
  const auth = await requireActionRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;
  const { actor } = auth;

  const admin = await createAdminClient();

  const { data: current } = await admin
    .from("class_sessions")
    .select("instructor_id, class_type_id")
    .eq("id", sessionId)
    .single();

  if (!current) return "Session not found.";

  if (actor.effectiveRole === "instructor" && current.instructor_id !== actor.user.id) {
    return "You may only manage add-ons on your own sessions.";
  }

  const resolvedAddonIds = [...new Set(addonIds)];

  // Verify every submitted id is actually eligible for this session's class type —
  // trusting the client's checklist alone would let a caller assign an add-on
  // that was never assigned to this class type by a super admin.
  if (resolvedAddonIds.length > 0) {
    const { data: eligible } = await admin
      .from("addon_class_types")
      .select("addon_id")
      .eq("class_type_id", current.class_type_id)
      .in("addon_id", resolvedAddonIds);

    const eligibleIds = new Set((eligible ?? []).map((e) => e.addon_id));
    if (resolvedAddonIds.some((id) => !eligibleIds.has(id))) {
      return "One or more selected add-ons are not eligible for this class type.";
    }
  }

  const { error: clearError } = await admin
    .from("session_addons")
    .delete()
    .eq("session_id", sessionId);
  if (clearError) return clearError.message;

  if (resolvedAddonIds.length > 0) {
    const { error: insertError } = await admin
      .from("session_addons")
      .insert(resolvedAddonIds.map((addon_id) => ({ session_id: sessionId, addon_id })));
    if (insertError) return insertError.message;
  }

  revalidatePath(`/admin/sessions/${sessionId}`);
  return null;
}

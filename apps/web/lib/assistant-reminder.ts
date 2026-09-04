/**
 * Assistant reminder helper.
 * BLS/ACLS classes require an in-room assistant once paid enrollment reaches
 * 9 students. Called right after a booking is created so the check always
 * sees the booking that may have crossed the threshold.
 * Used by: POST /api/bookings/confirm, POST /api/bookings/confirm-free.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { assistantNeededEmail } from "./emails";

/** Paid enrollment count at which BLS/ACLS classes require an assistant. */
const ASSISTANT_THRESHOLD = 9;

/** Shape of the class_sessions row needed to evaluate the assistant threshold. */
interface AssistantCheckSession {
  id: string;
  starts_at: string;
  instructor_id: string;
  assistant_instructor_id: string | null;
  assistant_name: string | null;
  assistant_reminder_sent_at: string | null;
  class_types: { name: string; requires_assistant_at_capacity: boolean } | { name: string; requires_assistant_at_capacity: boolean }[] | null;
  bookings: { cancelled: boolean }[] | null;
}

/**
 * Checks whether a session just crossed the assistant-required enrollment
 * threshold and, if so, emails the assigned instructor once.
 * Side effects: stamps class_sessions.assistant_reminder_sent_at (via a
 * conditional update that only succeeds for the request that wins the race),
 * sends a best-effort email through Resend.
 * @param supabase - Admin Supabase client.
 * @param sessionId - UUID of the class_sessions row just booked into.
 * @param baseUrl - App base URL for the email's session link.
 */
export async function maybeSendAssistantReminder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  sessionId: string,
  baseUrl: string
): Promise<void> {
  const { data: session, error } = await supabase
    .from("class_sessions")
    .select(
      `
      id, starts_at, instructor_id,
      assistant_instructor_id, assistant_name, assistant_reminder_sent_at,
      class_types ( name, requires_assistant_at_capacity ),
      bookings ( cancelled )
      `
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session) return;

  const row = session as unknown as AssistantCheckSession;

  const classType = Array.isArray(row.class_types) ? row.class_types[0] : row.class_types;
  if (!classType?.requires_assistant_at_capacity) return;
  if (row.assistant_instructor_id || row.assistant_name) return;
  if (row.assistant_reminder_sent_at) return;

  const activeCount = (row.bookings ?? []).filter((b) => !b.cancelled).length;
  if (activeCount < ASSISTANT_THRESHOLD) return;

  // Conditional update — only the request that flips this from null wins the
  // race and sends the email, guaranteeing exactly one send per session.
  const { data: claimed, error: claimError } = await supabase
    .from("class_sessions")
    .update({ assistant_reminder_sent_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("assistant_reminder_sent_at", null)
    .select("id");

  if (claimError || !claimed || claimed.length === 0) return;

  if (!isEmailConfigured()) return;

  const { data: instructor } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", row.instructor_id)
    .maybeSingle();

  if (!instructor?.email) return;

  const { subject, html } = assistantNeededEmail({
    instructorName: `${instructor.first_name} ${instructor.last_name}`,
    className: classType.name,
    sessionDate: row.starts_at,
    studentCount: activeCount,
    sessionId,
    baseUrl,
  });

  // The assistant_reminder_sent_at claim above already guarantees one send per
  // session, so the key here only guards this module's own retries.
  await sendEmail({
    context: "assistant-reminder",
    to: instructor.email,
    subject,
    html,
    idempotencyKey: `assistant-reminder-${sessionId}`,
  });
}

/**
 * rollcall-realtime.ts — shared constants for the rollcall live-update channel.
 *
 * Used by: app/api/rollcall/checkin-by-profile/route.ts (broadcasts on
 * check-in) and app/(admin)/_components/SessionDetailClient.tsx (listens, so
 * the instructor's Verified column updates without a manual page reload).
 *
 * This is a public (non-private) Supabase Realtime broadcast channel — no
 * table data flows over it, so it needs no RLS policy. The session UUID
 * scoping the topic is the same non-guessable capability token already used
 * to gate every other rollcall endpoint (session-students, student-profile,
 * checkin-by-profile), so exposure here is consistent with that model. Only
 * first/last name are broadcast — the same fields session-students already
 * exposes to anyone holding the sessionId; email/phone/address are not sent.
 */

/** Broadcast event name for a completed student check-in. */
export const ROLLCALL_VERIFIED_EVENT = "student_verified";

/**
 * Builds the channel topic for a given session's rollcall live updates.
 * @param sessionId - the class_sessions.id to scope the channel to
 */
export function rollcallChannelTopic(sessionId: string): string {
  return `rollcall:session:${sessionId}`;
}

/** Payload shape sent with the ROLLCALL_VERIFIED_EVENT broadcast. */
export interface RollcallVerifiedPayload {
  firstName: string;
  lastName: string;
}

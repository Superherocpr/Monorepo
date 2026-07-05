/**
 * POST /api/sessions/[id]/accept-teach
 * Called by: session detail page "Accept to Teach" button
 * Auth: instructor, manager, super_admin
 *
 * Atomically assigns the calling staff member as instructor on a customer-requested
 * session that has no instructor yet (first-come-first-serve).
 *
 * Uses a conditional UPDATE (WHERE instructor_id IS NULL) to avoid races.
 * If another instructor already claimed the session, returns 409.
 *
 * On success:
 *   1. Updates class_sessions.instructor_id
 *   2. Updates class_requests.status = 'instructor_assigned' (via class_request_id)
 *   3. Emails all super_admin and manager profiles about the assignment
 *
 * Returns { data: { ok: true } } on success, 409 on race-condition conflict.
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { instructorAcceptedAdminEmail } from "@/lib/emails";

/** Route handler params from the dynamic [id] segment. */
interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Assigns the calling instructor to a customer-requested session (atomic, first-come-first-serve).
 * Sends admin/manager notification emails on successful assignment.
 */
export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { id: sessionId } = await params;
  const actor = auth.actor;

  const admin = await createAdminClient();

  // Fetch the session to verify it's a customer-requested session with no instructor
  const { data: session } = await admin
    .from("class_sessions")
    .select(`
      id, instructor_id, class_request_id, starts_at,
      class_types ( name ),
      locations ( name, city, state )
    `)
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json(
      { data: null, error: "Session not found" },
      { status: 404 }
    );
  }

  if (!session.class_request_id) {
    return NextResponse.json(
      { data: null, error: "This session is not a customer-requested class" },
      { status: 400 }
    );
  }

  if (session.instructor_id !== null) {
    return NextResponse.json(
      { data: null, error: "This class has already been claimed by another instructor" },
      { status: 409 }
    );
  }

  // ── Atomic conditional update — only succeeds if instructor_id IS NULL ─────
  // Supabase does not expose affected-row count on UPDATE, so we use .select()
  // to see whether the row was actually modified. If instructor_id was set by a
  // concurrent request between our check and this write, the WHERE clause will
  // match zero rows and the return will be null.
  const { data: updatedSession, error: updateError } = await admin
    .from("class_sessions")
    .update({ instructor_id: actor.user.id })
    .eq("id", sessionId)
    .is("instructor_id", null)   // the atomic guard: only touch un-claimed rows
    .select("id, instructor_id")
    .single();

  if (updateError || !updatedSession || updatedSession.instructor_id !== actor.user.id) {
    // Another instructor got there first (race) or some other DB error
    console.warn(
      "[accept-teach] Concurrent claim detected or update failed for session:",
      sessionId,
      updateError
    );
    return NextResponse.json(
      { data: null, error: "This class was just claimed by another instructor" },
      { status: 409 }
    );
  }

  // ── Update class_requests status to instructor_assigned ───────────────────
  const { error: requestUpdateError } = await admin
    .from("class_requests")
    .update({ status: "instructor_assigned" })
    .eq("id", session.class_request_id);

  if (requestUpdateError) {
    // Non-fatal — session is assigned; log and continue
    console.error("[accept-teach] Failed to update class_request status:", requestUpdateError);
  }

  // ── Send admin notification emails (best-effort) ──────────────────────────
  if (!process.env.RESEND_API_KEY) {
    console.warn("[accept-teach] RESEND_API_KEY not set — skipping emails");
    return NextResponse.json({ data: { ok: true } });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  const classType = session.class_types as unknown as { name: string } | null;
  const location = session.locations as unknown as { name: string; city: string; state: string } | null;

  const { data: adminProfiles } = await admin
    .from("profiles")
    .select("email")
    .in("role", ["super_admin", "manager"])
    .eq("deactivated", false);

  const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean);

  if (adminEmails.length > 0 && classType && location) {
    const instructorFullName = `${actor.profile.first_name} ${actor.profile.last_name}`;

    const notifyEmail = instructorAcceptedAdminEmail({
      instructorName: instructorFullName,
      className: classType.name,
      sessionDate: session.starts_at,
      venueName: location.name,
      venueCity: location.city,
      venueState: location.state,
      sessionId,
      baseUrl,
    });

    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: adminEmails,
      subject: notifyEmail.subject,
      html: notifyEmail.html,
    });

    if (result.error) {
      console.error("[accept-teach] Admin notification email failed:", result.error);
    }
  }

  return NextResponse.json({ data: { ok: true } });
}

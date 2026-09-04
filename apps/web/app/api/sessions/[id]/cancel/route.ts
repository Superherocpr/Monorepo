/**
 * POST /api/sessions/[id]/cancel
 * Called by: session detail page "Cancel Session" button/form
 * Auth: instructor (own session only, >48hrs before start), manager, super_admin (no time limit)
 *
 * Cancels a class session and reopens it as a claimable "open opportunity":
 * status becomes 'cancelled' and instructor_id is cleared so any instructor
 * can claim it first-come-first-serve via POST /api/sessions/[id]/claim.
 * Location is left untouched — it only changes when someone claims the class.
 *
 * On success, emails (best-effort):
 *   1. All admin/manager profiles
 *   2. All active instructor/manager/super_admin profiles (the claim opportunity) —
 *      only sent when at least one student has already booked the session; if there
 *      are no bookings there is nothing to claim, so the email is suppressed.
 *
 * Enrolled students are NOT emailed at cancellation time — they only hear about
 * this once a new instructor claims the class (POST /api/sessions/[id]/claim),
 * so they get one email with the resolution instead of a cancellation notice
 * followed by a separate reassignment notice.
 *
 * Never touches refunds — those are always a separate, manual, super_admin-only
 * action via the existing invoice/order cancel-refund flows.
 *
 * Returns { data: { ok: true } } on success, 403 if an instructor tries to cancel
 * their own session within 48 hours or a session they don't own, 409 if already cancelled.
 */

import { NextResponse } from "next/server";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sessionCancelledAdminEmail, openOpportunityInstructorEmail } from "@/lib/emails";
import { msUntilClass } from "@/lib/business-time";

/** Route handler params from the dynamic [id] segment. */
interface Params {
  params: Promise<{ id: string }>;
}

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Cancels a session (role/time-window gated) and notifies students, admins, and
 * eligible instructors that it's now an open opportunity.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { id: sessionId } = await params;
  const actor = auth.actor;

  let reason: string;
  try {
    const body = await request.json();
    reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  } catch {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  if (reason.length < 10) {
    return NextResponse.json(
      { data: null, error: "Cancellation reason must be at least 10 characters." },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  const { data: session } = await admin
    .from("class_sessions")
    .select(
      `
      id, instructor_id, status, starts_at,
      class_types ( name ),
      locations ( name, city, state )
    `
    )
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ data: null, error: "Session not found" }, { status: 404 });
  }

  if (session.status === "cancelled") {
    return NextResponse.json(
      { data: null, error: "This session is already cancelled" },
      { status: 409 }
    );
  }

  if (actor.effectiveRole === "instructor") {
    if (session.instructor_id !== actor.user.id) {
      return NextResponse.json(
        { data: null, error: "You may only cancel your own sessions." },
        { status: 403 }
      );
    }

    // msUntilClass compares against the business wall clock — starts_at is a
    // floating wall-clock value, so a raw Date.now() would skew this window by
    // the UTC offset. See lib/business-time.ts.
    if (msUntilClass(session.starts_at) < FORTY_EIGHT_HOURS_MS) {
      return NextResponse.json(
        {
          data: null,
          error:
            "Classes within 48 hours can't be cancelled online. Please call Daniel Hedgeman directly.",
        },
        { status: 403 }
      );
    }
  }

  const { error: updateError } = await admin
    .from("class_sessions")
    .update({
      status: "cancelled",
      instructor_id: null,
      cancelled_at: new Date().toISOString(),
      cancelled_by: actor.user.id,
      cancellation_reason: reason,
    })
    .eq("id", sessionId);

  if (updateError) {
    console.error("[sessions/cancel] Failed to cancel session:", updateError);
    return NextResponse.json(
      { data: null, error: "Could not cancel this session. Please try again." },
      { status: 500 }
    );
  }

  // The cancellation is already committed. Skip the recipient lookups entirely
  // when no mail could be sent anyway; sendEmail would guard this too.
  if (!isEmailConfigured()) {
    console.warn("[sessions/cancel] Resend not configured — skipping emails");
    return NextResponse.json({ data: { ok: true } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  const classType = session.class_types as unknown as { name: string } | null;
  const location = session.locations as unknown as { name: string; city: string; state: string } | null;

  const [{ data: adminProfiles }, { data: instructorProfiles }, { count: bookingCount }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("email")
        .in("role", ["super_admin", "manager"])
        .eq("deactivated", false),
      admin
        .from("profiles")
        .select("email")
        .in("role", ["instructor", "manager", "super_admin"])
        .eq("deactivated", false),
      // Only send the instructor opportunity email when students have already booked;
      // an empty class has no one to teach, so notifying instructors is unnecessary noise.
      admin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("cancelled", false),
    ]);

  if (classType && location) {
    const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean);
    if (adminEmails.length > 0) {
      const cancelledByName = `${actor.profile.first_name} ${actor.profile.last_name}`;
      const adminEmail = sessionCancelledAdminEmail({
        className: classType.name,
        sessionDate: session.starts_at,
        venueName: location.name,
        cancelledByName,
        reason,
        sessionId,
        baseUrl,
      });
      await sendEmail({
        context: "sessions/cancel:admin",
        to: adminEmails,
        subject: adminEmail.subject,
        html: adminEmail.html,
      });
    }

    const instructorEmails = (instructorProfiles ?? []).map((p) => p.email).filter(Boolean);
    if ((bookingCount ?? 0) > 0 && instructorEmails.length > 0) {
      const opportunityEmail = openOpportunityInstructorEmail({
        className: classType.name,
        sessionDate: session.starts_at,
        venueName: location.name,
        venueCity: location.city,
        venueState: location.state,
        sessionId,
        baseUrl,
      });
      await sendEmail({
        context: "sessions/cancel:instructor-opportunity",
        to: instructorEmails,
        subject: opportunityEmail.subject,
        html: opportunityEmail.html,
      });
    }
  }

  return NextResponse.json({ data: { ok: true } });
}

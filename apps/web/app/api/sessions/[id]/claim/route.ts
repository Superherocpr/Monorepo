/**
 * POST /api/sessions/[id]/claim
 * Called by: session detail page "Claim This Class" button (open-opportunity banner)
 * Auth: instructor, manager, super_admin
 *
 * Atomically assigns the calling staff member as instructor on a cancelled,
 * unclaimed session (first-come-first-serve), and sets the location they'll
 * teach from. Session status returns to 'scheduled' immediately — no
 * re-approval step.
 *
 * Uses a conditional UPDATE (WHERE instructor_id IS NULL) to avoid races.
 * If another instructor already claimed the session, returns 409.
 *
 * On success, emails (best-effort):
 *   1. Every student with a non-cancelled booking on this session — new
 *      instructor name/contact + new location
 *   2. All admin/manager profiles
 *
 * Never triggers a refund — refunds are always a separate, manual,
 * super_admin-only action.
 *
 * Returns { data: { ok: true } } on success, 409 on race-condition conflict.
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sessionClaimedStudentEmail, sessionClaimedAdminEmail } from "@/lib/emails";

/** Route handler params from the dynamic [id] segment. */
interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { id: sessionId } = await params;
  const actor = auth.actor;

  let locationId: string;
  try {
    const body = await request.json();
    locationId = typeof body?.location_id === "string" ? body.location_id.trim() : "";
  } catch {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  if (!locationId) {
    return NextResponse.json(
      { data: null, error: "A location must be selected to claim this class." },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, name, city, state")
    .eq("id", locationId)
    .single();

  if (!location) {
    return NextResponse.json({ data: null, error: "Location not found" }, { status: 400 });
  }

  const { data: session } = await admin
    .from("class_sessions")
    .select(
      `
      id, instructor_id, status, starts_at,
      class_types ( name )
    `
    )
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json({ data: null, error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "cancelled") {
    return NextResponse.json(
      { data: null, error: "This class is not open for claiming." },
      { status: 400 }
    );
  }

  if (session.instructor_id !== null) {
    return NextResponse.json(
      { data: null, error: "This class was just claimed by another instructor" },
      { status: 409 }
    );
  }

  // ── Atomic conditional update — only succeeds if instructor_id IS NULL ─────
  const { data: updatedSession, error: updateError } = await admin
    .from("class_sessions")
    .update({
      instructor_id: actor.user.id,
      location_id: locationId,
      status: "scheduled",
    })
    .eq("id", sessionId)
    .is("instructor_id", null) // the atomic guard: only touch un-claimed rows
    .select("id, instructor_id")
    .single();

  if (updateError || !updatedSession || updatedSession.instructor_id !== actor.user.id) {
    console.warn(
      "[sessions/claim] Concurrent claim detected or update failed for session:",
      sessionId,
      updateError
    );
    return NextResponse.json(
      { data: null, error: "This class was just claimed by another instructor" },
      { status: 409 }
    );
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn("[sessions/claim] RESEND_API_KEY not set — skipping emails");
    return NextResponse.json({ data: { ok: true } });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  const classType = session.class_types as unknown as { name: string } | null;

  const { data: claimingProfile } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", actor.user.id)
    .single();

  const instructorFullName = `${actor.profile.first_name} ${actor.profile.last_name}`;
  const instructorPhone = claimingProfile?.phone ?? null;

  if (classType) {
    const [{ data: bookings }, { data: adminProfiles }] = await Promise.all([
      admin
        .from("bookings")
        .select("profiles!bookings_customer_id_fkey ( first_name, email )")
        .eq("session_id", sessionId)
        .eq("cancelled", false),
      admin
        .from("profiles")
        .select("email")
        .in("role", ["super_admin", "manager"])
        .eq("deactivated", false),
    ]);

    const students = (bookings ?? [])
      .map((b) => b.profiles as unknown as { first_name: string; email: string } | null)
      .filter((p): p is { first_name: string; email: string } => !!p?.email);

    await Promise.all(
      students.map(async (student) => {
        const studentEmail = sessionClaimedStudentEmail({
          firstName: student.first_name,
          className: classType.name,
          sessionDate: session.starts_at,
          newInstructorName: instructorFullName,
          newInstructorPhone: instructorPhone,
          newVenueName: location.name,
          newVenueCity: location.city,
          newVenueState: location.state,
        });
        const result = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: student.email,
          subject: studentEmail.subject,
          html: studentEmail.html,
        });
        if (result.error) {
          console.error("[sessions/claim] Student notification email failed:", result.error);
        }
      })
    );

    const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean);
    if (adminEmails.length > 0) {
      const adminEmail = sessionClaimedAdminEmail({
        className: classType.name,
        sessionDate: session.starts_at,
        newInstructorName: instructorFullName,
        sessionId,
        baseUrl,
      });
      const result = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: adminEmails,
        subject: adminEmail.subject,
        html: adminEmail.html,
      });
      if (result.error) {
        console.error("[sessions/claim] Admin notification email failed:", result.error);
      }
    }
  }

  return NextResponse.json({ data: { ok: true } });
}

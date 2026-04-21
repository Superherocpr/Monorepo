/**
 * POST /api/roster/import
 * Called by: RosterImportClient after manager/super admin confirms the student preview
 * Auth: Authenticated — manager or super admin only
 *
 * Batch-inserts validated student rows into roster_records, marks the session as
 * roster_imported, generates a session_token if one doesn't exist yet, sets
 * correction_window_closes_at to starts_at + 30 min, and optionally marks a
 * customer roster_upload as imported.
 *
 * Returns 403 if the caller is not manager or super admin.
 * Returns 400 if required fields are missing.
 * Returns 500 on database error.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

/** Shape of a single student row sent from the client. */
interface StudentRow {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
}

/** Expected request body shape. */
interface ImportRequestBody {
  sessionId: string;
  students: StudentRow[];
  /** Optional — if a customer roster was loaded, mark it as imported. */
  rosterUploadId: string | null;
}

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { sessionId, students, rosterUploadId } = body as ImportRequestBody;

  if (!sessionId || !Array.isArray(students)) {
    return Response.json({ success: false, error: "sessionId and students are required" }, { status: 400 });
  }

  // Auth check — must be logged in and have manager or super_admin role
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["manager", "super_admin"].includes(profile.role)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // Use admin client for writes to bypass RLS restrictions on staff-side inserts
  const admin = await createAdminClient();

  // Re-check for duplicate emails server-side before inserting —
  // the client-side duplicate detection is a UX convenience only, not a security gate.
  const { data: existingRecords } = await admin
    .from("roster_records")
    .select("email")
    .eq("session_id", sessionId);

  const existingEmails = new Set(
    (existingRecords ?? [])
      .map((r: { email: string | null }) => r.email?.toLowerCase())
      .filter(Boolean)
  );

  // Filter out any duplicates that snuck through (same logic as client: email match = skip)
  const toInsert = students.filter((s) => {
    if (!s.email) return true; // No email — can't be a duplicate, always import
    return !existingEmails.has(s.email.toLowerCase());
  });

  if (toInsert.length === 0) {
    return Response.json({ success: true, inserted: 0, skipped: students.length });
  }

  // Batch insert roster_records
  const { error: insertError } = await admin.from("roster_records").insert(
    toInsert.map((s) => ({
      session_id: sessionId,
      first_name: s.firstName,
      last_name: s.lastName,
      email: s.email || null,
      phone: s.phone || null,
      employer: s.employer || null,
    }))
  );

  if (insertError) {
    console.error("[roster/import] Insert error:", insertError.message);
    return Response.json({ success: false, error: "Failed to insert students" }, { status: 500 });
  }

  // Fetch the session's starts_at and current session_token to compute the correction window
  const { data: session } = await admin
    .from("class_sessions")
    .select("starts_at, session_token")
    .eq("id", sessionId)
    .single();

  const correctionWindowClosesAt = session?.starts_at
    ? new Date(new Date(session.starts_at).getTime() + 30 * 60 * 1000).toISOString()
    : null;

  // Mark the session as roster_imported and set the correction window.
  // Generate a session_token if one hasn't been set yet — this token is used
  // in the public roster correction URL (/roster/[session_token]).
  const { error: sessionUpdateError } = await admin
    .from("class_sessions")
    .update({
      roster_imported: true,
      session_token: session?.session_token ?? randomUUID(),
      correction_window_closes_at: correctionWindowClosesAt,
    })
    .eq("id", sessionId);

  if (sessionUpdateError) {
    // Non-fatal — the roster records were inserted. Log and continue.
    console.error("[roster/import] Session update error:", sessionUpdateError.message);
  }

  // If a customer roster upload was used, mark it as imported
  if (rosterUploadId) {
    const { error: uploadError } = await admin
      .from("roster_uploads")
      .update({ imported: true })
      .eq("id", rosterUploadId);

    if (uploadError) {
      // Non-fatal — log and continue
      console.error("[roster/import] roster_uploads update error:", uploadError.message);
    }
  }

  return Response.json({
    success: true,
    inserted: toInsert.length,
    skipped: students.length - toInsert.length,
  });
}

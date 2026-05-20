/**
 * POST /api/enrollware/mark-submitted
 * Called by: Enrollware bookmarklet after the instructor confirms students
 *            have been imported into Enrollware for a class.
 * Auth: Bearer API key (validated against api_keys table via enrollware-api-auth)
 *
 * Sets enrollware_submitted = true on the specified class_session. This removes
 * the session from the bookmarklet's pending class list so it cannot be
 * accidentally double-submitted.
 *
 * Verifies that the session belongs to the authenticated instructor before
 * updating — prevents one instructor from marking another's class as submitted.
 *
 * Handles OPTIONS preflight for CORS.
 */

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  validateEnrollwareKey,
  enrollwareCorsHeaders,
} from "@/lib/enrollware-api-auth";

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: enrollwareCorsHeaders(origin),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("Origin");
  const cors = enrollwareCorsHeaders(origin);

  const auth = await validateEnrollwareKey(request);
  if (!auth.ok) {
    // Re-wrap so CORS headers are present on the rejection
    const body = await auth.response.text();
    return new Response(body, {
      status: auth.response.status,
      headers: {
        "Content-Type": auth.response.headers.get("Content-Type") ?? "application/json",
        ...cors,
      },
    });
  }

  const { profileId } = auth;

  const body = await request.json().catch(() => null);
  const sessionId = body?.sessionId;

  if (!sessionId || typeof sessionId !== "string") {
    return Response.json(
      { error: "sessionId is required." },
      { status: 400, headers: cors }
    );
  }

  const admin = await createAdminClient();

  // Update only when the session belongs to the authenticated instructor.
  // We chain .select("id") so the response includes the matched rows — that's
  // the only reliable way to know whether the row existed and was ours
  // (Supabase's plain update returns count: null without the count option).
  const { data: updated, error } = await admin
    .from("class_sessions")
    .update({ enrollware_submitted: true })
    .eq("id", sessionId)
    .eq("instructor_id", profileId)
    .select("id");

  if (error) {
    console.error("[enrollware/mark-submitted] Update error:", error.message);
    return Response.json(
      { error: "Failed to update session." },
      { status: 500, headers: cors }
    );
  }

  // No matched row means the session doesn't exist or belongs to someone else
  if (!updated || updated.length === 0) {
    return Response.json(
      { error: "Session not found or not authorized." },
      { status: 404, headers: cors }
    );
  }

  return Response.json({ success: true }, { status: 200, headers: cors });
}

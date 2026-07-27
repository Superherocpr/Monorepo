/**
 * GET  /api/contact/[id]/notes — fetch all notes for a submission, newest first
 * POST /api/contact/[id]/notes — create a new note on a submission
 * Auth: manager and super_admin only
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

export interface ContactNote {
  id: string;
  body: string;
  created_by_name: string;
  created_at: string;
}

/**
 * Returns all notes for the submission ordered newest first.
 * @param _request - Unused.
 * @param params   - Route params containing the submission id.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!id) {
    return Response.json({ success: false, error: "Missing submission id." }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data, error } = await admin
    .from("contact_notes")
    .select("id, body, created_at, profiles!created_by(first_name, last_name)")
    .eq("submission_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[contact/[id]/notes] GET failed:", error);
    return Response.json({ success: false, error: "Failed to load notes." }, { status: 500 });
  }

  const notes: ContactNote[] = (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const name = profile
      ? `${(profile as { first_name: string; last_name: string }).first_name} ${(profile as { first_name: string; last_name: string }).last_name}`.trim()
      : "Unknown";
    return { id: row.id, body: row.body, created_by_name: name, created_at: row.created_at };
  });

  return Response.json({ success: true, notes });
}

/**
 * Creates a new note on the submission attributed to the authenticated staff member.
 * @param request - JSON body with { body: string }.
 * @param params  - Route params containing the submission id.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const { actor } = authResult;
  const { id } = await params;
  if (!id) {
    return Response.json({ success: false, error: "Missing submission id." }, { status: 400 });
  }

  let body: { body?: unknown };
  try {
    body = (await request.json()) as { body?: unknown };
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body.body || typeof body.body !== "string" || !body.body.trim()) {
    return Response.json({ success: false, error: "Note body is required." }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data, error } = await admin
    .from("contact_notes")
    .insert({ submission_id: id, body: body.body.trim(), created_by: actor.profile.id })
    .select("id, body, created_at")
    .single();

  if (error || !data) {
    console.error("[contact/[id]/notes] POST failed:", error);
    return Response.json({ success: false, error: "Failed to save note." }, { status: 500 });
  }

  const authorName =
    `${actor.profile.first_name} ${actor.profile.last_name}`.trim() || "Staff";

  const note: ContactNote = {
    id: data.id,
    body: data.body,
    created_by_name: authorName,
    created_at: data.created_at,
  };

  return Response.json({ success: true, note });
}

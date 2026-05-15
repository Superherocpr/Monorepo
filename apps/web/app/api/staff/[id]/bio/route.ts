/**
 * PATCH /api/staff/[id]/bio
 * Called by: BioEditPanel when an admin saves an instructor's about-page bio.
 * Auth: super_admin only.
 * Updates the bio_photo and bio_description fields on the target profile.
 * Both fields are optional — omitting a field leaves the existing value unchanged.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

interface BioPayload {
  /** Public S3 URL for the instructor's headshot. Null clears the photo. */
  bio_photo?: string | null;
  /** Plain-text bio paragraph shown on the /about page. Null clears the description. */
  bio_description?: string | null;
  /** Comma-separated credentials shown as checkmark items on the /about page. Null clears credentials. */
  bio_credentials?: string | null;
  /** Years of experience for the lead instructor stat block (e.g. "20"). Null hides the stat. */
  bio_years_experience?: string | null;
  /** Students trained figure for the lead instructor stat block (e.g. "5,000+"). Null hides the stat. */
  bio_students_trained?: string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!callerProfile || (callerProfile.role as UserRole) !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: BioPayload;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Build the update object with only the fields that were provided
  const update: Record<string, string | null> = {};
  if ("bio_photo" in body) update.bio_photo = body.bio_photo ?? null;
  if ("bio_description" in body) update.bio_description = body.bio_description ?? null;
  if ("bio_credentials" in body) update.bio_credentials = body.bio_credentials ?? null;
  if ("bio_years_experience" in body) update.bio_years_experience = body.bio_years_experience ?? null;
  if ("bio_students_trained" in body) update.bio_students_trained = body.bio_students_trained ?? null;

  if (Object.keys(update).length === 0) {
    return Response.json(
      { success: false, error: "No fields provided to update." },
      { status: 400 }
    );
  }

  // ── Verify target exists and is staff (not a customer) ─────────────────────
  const { id: staffId } = await params;

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", staffId)
    .single();

  if (!targetProfile) {
    return Response.json({ success: false, error: "Staff member not found." }, { status: 404 });
  }

  if (targetProfile.role === "customer") {
    // Bio editing is only meaningful for staff who appear on the about page
    return Response.json(
      { success: false, error: "Bio editing is only available for staff members." },
      { status: 400 }
    );
  }

  // ── Apply update ────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", staffId);

  if (error) {
    console.error(`[staff/${staffId}/bio] DB update failed:`, error);
    return Response.json(
      { success: false, error: "Failed to save bio. Please try again." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}

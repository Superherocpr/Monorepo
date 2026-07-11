/**
 * POST /api/enrollware/generate-key
 * Called by: Companion admin page (/admin/enrollware-tool) when instructor
 *            clicks "Generate Bookmarklet".
 * Auth: Supabase session cookie — instructor must be logged in to SuperheroCPR.
 *
 * Creates (or replaces) an API key labeled "enrollware-bookmarklet" for the
 * authenticated instructor. The raw key is returned ONCE in the response and
 * never stored — only its SHA-256 hash is written to the api_keys table.
 *
 * If the instructor already has an enrollware-bookmarklet key, the old one is
 * deleted first so only one active key exists at a time.
 *
 * Returns 401 if not authenticated.
 * Returns 403 if the caller is not a staff-level role.
 * Returns 500 on database error.
 */

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

export async function POST() {
  // Authenticate via Supabase session (companion page caller is always logged in).
  // Honors view-as; archived/deactivated checks happen inside requireApiRole.
  const authResult = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const user = authResult.actor.user;

  const admin = await createAdminClient();

  // Delete any existing enrollware-bookmarklet key for this user so there is
  // never more than one active key — regenerating always invalidates the old one.
  await admin
    .from("api_keys")
    .delete()
    .eq("profile_id", user.id)
    .eq("label", "enrollware-bookmarklet");

  // Generate a 32-byte (64 hex char) cryptographically random key.
  // The raw key is returned to the caller once and never stored.
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const { error: insertError } = await admin.from("api_keys").insert({
    profile_id: user.id,
    key_hash: keyHash,
    label: "enrollware-bookmarklet",
  });

  if (insertError) {
    console.error("[enrollware/generate-key] Insert error:", insertError.message);
    return Response.json({ error: "Failed to generate key." }, { status: 500 });
  }

  // Return the raw key — this is the ONLY time it will ever be visible.
  // The client must display it immediately for the instructor to save.
  return Response.json({ key: rawKey }, { status: 200 });
}

/**
 * POST /api/staff/[id]/resend-invite
 * Called by: Admin Staff Management — Staff List actions
 * Auth: super_admin only
 * Generates a fresh password setup link for an existing staff member and
 * re-sends the invitation email. Useful when the original email was lost
 * or the link expired.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sendEmail } from "@/lib/send-email";
import { staffInviteEmail } from "@/lib/emails";

/** Maps stored role values to human-readable labels for the email. */
const ROLE_LABELS: Record<string, string> = {
  instructor: "Instructor",
  manager: "Manager",
  inspector: "Inspector",
  super_admin: "Super Admin",
};

/**
 * Re-sends the staff invitation email with a fresh password setup link.
 * No request body is required — all data is pulled from the existing profile.
 * @param _request - Unused; no body expected.
 * @param params - Route param containing the target staff member's profile ID.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const { id: staffId } = await params;

  // ── Look up target staff member ────────────────────────────────────────────
  // Use the admin client so we can access fields regardless of RLS policies.
  const adminSupabase = await createAdminClient();
  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("id, first_name, email, role, deactivated")
    .eq("id", staffId)
    .neq("role", "customer")
    .single();

  if (profileError || !profile) {
    return Response.json({ success: false, error: "Staff member not found." }, { status: 404 });
  }

  if (profile.deactivated) {
    return Response.json(
      { success: false, error: "Cannot resend invite to a deactivated account." },
      { status: 400 }
    );
  }

  // ── Generate fresh password setup link ────────────────────────────────────
  // Uses the same recovery link approach as the original invite: extract the
  // hashed_token so the link goes directly to /setup-password without needing
  // the Supabase redirect URL in the Auth allowlist.
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error(`[staff/${staffId}/resend-invite] generateLink failed:`, linkError);
    return Response.json(
      { success: false, error: "Failed to generate invite link. Please try again." },
      { status: 500 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  const setupLink = `${baseUrl}/setup-password?token_hash=${linkData.properties.hashed_token}&type=recovery`;

  // ── Send invitation email ──────────────────────────────────────────────────
  const roleLabel = ROLE_LABELS[profile.role] ?? profile.role;

  const { subject, html } = staffInviteEmail({
    firstName: profile.first_name,
    // No personal message on resends — the account already exists
    personalMessage: null,
    roleLabel,
    actionLink: setupLink,
    isInstructor: profile.role === "instructor",
  });

  // Sending the mail IS this route's entire purpose, so unlike most call sites a
  // failure here is fatal and surfaces to the admin who clicked the button.
  const result = await sendEmail({
    context: "staff/resend-invite",
    to: profile.email,
    subject,
    html,
  });

  if (!result.sent) {
    return Response.json(
      { success: false, error: "Failed to send invite email. Please try again." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}

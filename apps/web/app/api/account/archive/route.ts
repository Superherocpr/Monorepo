/**
 * POST /api/account/archive
 * Called by: /dashboard/settings (SettingsClient.tsx — Delete Account confirm flow)
 * Auth: Requires active Supabase session (user must be logged in)
 * Sets profiles.archived = true and archived_at = now.
 * Sends an account-deletion confirmation email via Resend.
 * Does NOT delete the auth user — records are preserved for certification history.
 */

import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/** Archives the authenticated customer's account and sends a confirmation email. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  // Fetch profile for the email before archiving
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, email")
    .eq("id", user.id)
    .single();

  const { error } = await supabase
    .from("profiles")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return Response.json(
      { success: false, error: "Failed to archive account" },
      { status: 500 }
    );
  }

  // Send account deletion confirmation email — non-fatal if this fails
  if (profile) {
    await resend.emails.send({
      from: "Superhero CPR <noreply@superherocpr.com>",
      to: profile.email,
      subject: "Your Superhero CPR account has been deleted",
      html: `
        <h1>Account Deleted</h1>
        <p>Hi ${profile.first_name},</p>
        <p>Your Superhero CPR account has been successfully deleted. You will no longer be able to log in.</p>
        <p>Your certification history has been preserved for our records.</p>
        <p>If you believe this was a mistake or wish to restore your account, please contact us at <a href="mailto:info@superherocpr.com">info@superherocpr.com</a> or call (813) 966-3969.</p>
        <p>— The Superhero CPR Team</p>
      `,
    });
  }

  return Response.json({ success: true });
}

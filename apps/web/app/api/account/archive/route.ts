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
import { accountDeletedEmail } from "@/lib/emails";

/** Archives the authenticated customer's account and sends a confirmation email. */
export async function POST() {
  // Instantiated inside the handler so it never executes at build time
  const resend = new Resend(process.env.RESEND_API_KEY);
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
    const { subject, html } = accountDeletedEmail({ firstName: profile.first_name });
    await resend.emails.send({
      from: "SuperHeroCPR <noreply@superherocpr.com>",
      to: profile.email,
      subject,
      html,
    });
  }

  return Response.json({ success: true });
}

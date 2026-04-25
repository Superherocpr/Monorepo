/**
 * POST /api/certifications/send-reminders
 * Called by: CertificationsClient — "Send Reminders to All" button in expiring-soon banner
 * Auth: super_admin only
 * Sends expiry reminder emails via Resend to all customers whose cert expires
 * within 90 days and who have not yet been reminded (reminder_sent = false).
 * Already-reminded customers are silently skipped.
 * Blocked when the system_settings key cert_reminders_paused is "true".
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";

/**
 * Sends batch cert expiry reminders to eligible customers.
 * Returns: { success: boolean, count: number }
 * @param _request - Incoming POST request (no body required)
 */
export async function POST(_request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Check whether reminders are paused ────────────────────────────────────
  // Always verify at the API layer even though the client button is disabled
  // when paused — prevents any race condition or direct API call bypass.
  const adminSupabase = await createAdminClient();
  const { data: setting } = await adminSupabase
    .from("system_settings")
    .select("value")
    .eq("key", "cert_reminders_paused")
    .maybeSingle();

  if (setting?.value === "true") {
    return Response.json(
      { success: false, error: "Reminders are currently paused." },
      { status: 403 }
    );
  }

  // ── Fetch eligible certs ───────────────────────────────────────────────────
  const now = new Date();
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const { data: certs, error: certsError } = await supabase
    .from("certifications")
    .select(`
      id, expires_at,
      profiles!customer_id ( first_name, email ),
      cert_types ( name )
    `)
    .eq("reminder_sent", false)
    .gte("expires_at", now.toISOString().split("T")[0])
    .lte("expires_at", ninetyDaysFromNow.toISOString().split("T")[0]);

  if (certsError) {
    console.error("[POST /api/certifications/send-reminders] Fetch error", certsError);
    return Response.json({ error: "Failed to fetch certifications." }, { status: 500 });
  }

  if (!certs?.length) {
    return Response.json({ success: true, count: 0 });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sentCount = 0;

  for (const cert of certs) {
    const daysRemaining = Math.ceil(
      (new Date(cert.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Type narrowing: the joined profiles/cert_types may be arrays or single objects
    // depending on how Supabase returns the join. Guard for both shapes.
    const profileData = Array.isArray(cert.profiles) ? cert.profiles[0] : cert.profiles;
    const certTypeData = Array.isArray(cert.cert_types) ? cert.cert_types[0] : cert.cert_types;

    if (!profileData?.email || !certTypeData?.name) continue;

    try {
      await resend.emails.send({
        from: "SuperHeroCPR <noreply@superherocpr.com>",
        to: profileData.email,
        subject: "Your CPR Certification Expires Soon",
        html: `
          <h1>Your certification is expiring soon, ${profileData.first_name}!</h1>
          <p>Your <strong>${certTypeData.name}</strong> certification expires in
          <strong>${daysRemaining} day${daysRemaining !== 1 ? "s" : ""}</strong>.</p>
          <p>Book a renewal class today to stay certified.</p>
          <a href="https://superherocpr.com/book">Book a Renewal Class →</a>
          <p>— The SuperHeroCPR Team</p>
        `,
      });

      // Mark the cert as reminded immediately after a successful send
      await supabase
        .from("certifications")
        .update({ reminder_sent: true })
        .eq("id", cert.id);

      sentCount++;
    } catch (emailError) {
      // Log the failure but continue sending to other customers
      console.error(
        "[POST /api/certifications/send-reminders] Email send failed for cert",
        cert.id,
        emailError
      );
    }
  }

  return Response.json({ success: true, count: sentCount });
}

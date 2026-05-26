/**
 * GET /api/contact/zoho-auth
 * Called by: /admin/settings — "Connect Zoho Mail" button
 * Auth: super_admin only
 * Redirects the browser to the Zoho OAuth 2.0 authorization page.
 * After the user approves, Zoho redirects to /api/contact/zoho-callback.
 *
 * Required env vars: ZOHO_CLIENT_ID, ZOHO_REDIRECT_URI
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Initiates the Zoho OAuth flow by redirecting to the Zoho authorization page.
 * @param _request - GET request (no params used).
 */
export async function GET(_request: Request) {
  const supabase = await createClient();

  // ── Auth & role check — super_admin only ───────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || actor.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Build Zoho authorization URL ──────────────────────────────────────────
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return Response.json(
      { error: "ZOHO_CLIENT_ID or ZOHO_REDIRECT_URI env vars are not set." },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    // ZohoMail.messages.CREATE — send emails; ZohoMail.messages.READ — read thread
    scope: "ZohoMail.messages.CREATE,ZohoMail.messages.READ,ZohoMail.accounts.READ",
    redirect_uri: redirectUri,
    access_type: "offline", // offline = include refresh_token in response
    // prompt=consent forces Zoho to re-issue a refresh_token on every authorization.
    // Without this, Zoho only returns a refresh_token on the very first approval —
    // subsequent connects return only an access_token, which expires after 1 hour
    // and leaves the integration permanently broken.
    prompt: "consent",
  });

  redirect(`https://accounts.zoho.com/oauth/v2/auth?${params.toString()}`);
}

/**
 * GET /api/contact/zoho-callback
 * Called by: Zoho OAuth redirect after user approves the connection
 * Auth: The state is verified by checking the session — super_admin only.
 * Exchanges the auth code for access + refresh tokens, fetches the Zoho
 * account ID, and stores all credentials in system_settings.
 * Redirects to /admin/settings with a ?zoho=connected success flag.
 *
 * Required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateSetting, fetchZohoAccountId } from "@/lib/zoho";

/**
 * Handles the Zoho OAuth callback. Exchanges the code for tokens and stores them.
 * @param request - GET request with ?code= and optional ?error= params from Zoho.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    // Zoho returned an error or the user denied access
    redirect(`/admin/settings?zoho=error&reason=${encodeURIComponent(error ?? "no_code")}`);
  }

  const supabase = await createClient();

  // ── Auth & role check — super_admin only ───────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || actor.role !== "super_admin") {
    redirect("/admin");
  }

  // ── Exchange code for tokens ──────────────────────────────────────────────
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    redirect("/admin/settings?zoho=error&reason=missing_env");
  }

  const tokenRes = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    redirect("/admin/settings?zoho=error&reason=token_exchange_failed");
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (tokenData.error || !tokenData.access_token || !tokenData.refresh_token) {
    const reason = encodeURIComponent(tokenData.error ?? "missing_tokens");
    redirect(`/admin/settings?zoho=error&reason=${reason}`);
  }

  // ── Fetch Zoho account ID ─────────────────────────────────────────────────
  let accountId: string;
  try {
    accountId = await fetchZohoAccountId(tokenData.access_token);
  } catch {
    redirect("/admin/settings?zoho=error&reason=account_fetch_failed");
  }

  // ── Persist credentials in system_settings ────────────────────────────────
  const expiresAt = new Date(
    Date.now() + (tokenData.expires_in ?? 3600) * 1000
  ).toISOString();

  await Promise.all([
    updateSetting("zoho_access_token", tokenData.access_token),
    updateSetting("zoho_refresh_token", tokenData.refresh_token),
    updateSetting("zoho_account_id", accountId),
    updateSetting("zoho_token_expires_at", expiresAt),
  ]);

  redirect("/admin/settings?zoho=connected");
}

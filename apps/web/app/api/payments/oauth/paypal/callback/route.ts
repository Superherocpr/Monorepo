/**
 * GET /api/payments/oauth/paypal/callback
 * Called by: PayPal — redirected here after instructor grants consent
 * Auth: must be a logged-in instructor or super_admin (session persists through OAuth redirect)
 * Exchanges the authorization code for tokens, fetches the PayPal merchant
 * payer_id from the userinfo endpoint, stores encrypted tokens + payer_id in
 * instructor_payment_accounts, redirects to payment settings.
 *
 * The stored `platform_account_id` is the PayPal **payer ID** (a 13-char
 * merchant identifier) — NOT the email — because the `PayPal-Auth-Assertion`
 * header used to route booking funds requires `payer_id`. Storing the email
 * here would cause every instructor-routed payment to fail with PAYER_ID_NOT_FOUND.
 */

import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { encryptToken } from "@/lib/crypto";
import { getPayPalApiBase } from "@/lib/paypal";
import type { UserRole } from "@/types/users";

/** Roles permitted to connect payment accounts. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Handles the PayPal OAuth callback.
 * Verifies CSRF state, exchanges code for tokens, stores encrypted credentials.
 * @param request - The incoming GET request with code + state query params.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  // If the user denied access on PayPal's side
  if (error) {
    redirect("/admin/profile/payment?error=denied");
  }

  if (!code || !stateParam) {
    redirect("/admin/profile/payment?error=invalid_callback");
  }

  // ── Verify CSRF state ──────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state_paypal")?.value;
  cookieStore.delete("oauth_state_paypal");

  if (!storedState || storedState !== stateParam) {
    redirect("/admin/profile/payment?error=state_mismatch");
  }

  // ── Auth check ─────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/profile/payment");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  // ── Exchange code for tokens ───────────────────────────────────────────────
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  const redirectUri = process.env.PAYPAL_REDIRECT_URI ?? "";
  // Use the unified env-derived base so token exchange targets the same
  // environment (sandbox vs. live) as the consent screen the user just used.
  const apiBase = getPayPalApiBase();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    redirect("/admin/profile/payment?error=token_exchange_failed");
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
  };

  // ── Fetch the instructor's PayPal merchant payer_id ──────────────────────
  // The `paypalv1.1` schema returns the merchant identifiers directly:
  //   - `payer_id`: the 13-char merchant ID (preferred — required by Auth-Assertion)
  //   - `user_id`:  a URN of the form ".../identity/user/<payer_id>" (fallback)
  //   - `emails`:   array of {value, primary} (NOT a valid auth-assertion identity)
  // We MUST store the payer_id because PayPal-Auth-Assertion's `payer_id`
  // claim only accepts a merchant ID; emails are rejected with PAYER_ID_NOT_FOUND.
  // Current PayPal Identity v1 endpoint — replaces the deprecated
  // /v1/oauth2/token/userinfo?schema=paypalv1.1 path.
  // With the paypalattributes scope, this returns user_id as a URN
  // of the form ".../identity/user/<payer_id>" which we extract below.
  const userInfoRes = await fetch(
    `${apiBase}/v1/identity/openidconnect/userinfo?schema=openid`,
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    }
  );

  let platformAccountId: string | null = null;
  if (userInfoRes.ok) {
    const userInfo = (await userInfoRes.json()) as {
      payer_id?: string;
      user_id?: string;
      emails?: { value: string; primary?: boolean }[];
    };
    if (userInfo.payer_id) {
      platformAccountId = userInfo.payer_id;
    } else if (userInfo.user_id) {
      // Fallback — extract the payer_id from the trailing URN segment.
      const segments = userInfo.user_id.split("/");
      platformAccountId = segments[segments.length - 1] || null;
    }
    // Intentionally do NOT fall back to email — see comment above.
  }

  // If PayPal didn't return a usable merchant ID the account is useless for
  // routing booking funds. Abort rather than silently storing garbage.
  if (!platformAccountId) {
    redirect("/admin/profile/payment?error=missing_payer_id");
  }

  // ── Store in DB — upsert on (instructor_id, platform) ─────────────────────
  // Determine is_active: true only if this is the instructor's first connected account
  const { count: existingCount } = await supabase
    .from("instructor_payment_accounts")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", profile.id);

  const isFirstAccount = !existingCount || existingCount === 0;

  // Check if a record for this platform already exists (reconnect scenario)
  const { data: existing } = await supabase
    .from("instructor_payment_accounts")
    .select("id, is_active")
    .eq("instructor_id", profile.id)
    .eq("platform", "paypal")
    .maybeSingle();

  if (existing) {
    // Reconnect — update tokens, preserve is_active status
    const { error: updateError } = await supabase
      .from("instructor_payment_accounts")
      .update({
        access_token: encryptToken(tokenData.access_token),
        refresh_token: encryptToken(tokenData.refresh_token),
        platform_account_id: platformAccountId,
        connected_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      console.error("[oauth/paypal/callback] Update failed:", updateError);
      redirect("/admin/profile/payment?error=db_write_failed");
    }
  } else {
    // New connection
    const { error: insertError } = await supabase
      .from("instructor_payment_accounts")
      .insert({
        instructor_id: profile.id,
        platform: "paypal",
        access_token: encryptToken(tokenData.access_token),
        refresh_token: encryptToken(tokenData.refresh_token),
        platform_account_id: platformAccountId,
        is_active: isFirstAccount,
      });

    if (insertError) {
      console.error("[oauth/paypal/callback] Insert failed:", insertError);
      redirect("/admin/profile/payment?error=db_write_failed");
    }
  }

  redirect("/admin/profile/payment?connected=paypal");
}

/**
 * GET /api/payments/oauth/venmo/callback
 * Called by: PayPal (Venmo Business) — redirected here after instructor grants consent
 * Auth: must be a logged-in instructor or super_admin
 * Exchanges the authorization code for tokens via PayPal's OAuth (Venmo uses PayPal infra),
 * fetches the PayPal/Venmo account email, stores encrypted tokens in instructor_payment_accounts,
 * and redirects to payment settings.
 */

import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { encryptToken } from "@/lib/crypto";
import type { UserRole } from "@/types/users";

/** Roles permitted to connect payment accounts. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Handles the Venmo Business OAuth callback.
 * Uses PayPal's OAuth infrastructure (same client ID/secret, different redirect URI).
 * Verifies CSRF state, exchanges code for tokens, stores encrypted credentials.
 * @param request - The incoming GET request with code + state query params.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    redirect("/admin/profile/payment?error=denied");
  }
  if (!code || !stateParam) {
    redirect("/admin/profile/payment?error=invalid_callback");
  }

  // ── Verify CSRF state ──────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state_venmo")?.value;
  cookieStore.delete("oauth_state_venmo");

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
  // Venmo Business uses PayPal's token endpoint but with the Venmo redirect URI
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  const redirectUri = process.env.VENMO_REDIRECT_URI ?? "";
  const apiBase = process.env.PAYPAL_API_BASE ?? "https://api-m.paypal.com";

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

  // Fetch the Venmo/PayPal account email as the identifier
  const userInfoRes = await fetch(`${apiBase}/v1/oauth2/token/userinfo?schema=paypalv1.1`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    cache: "no-store",
  });

  let platformAccountId: string | null = null;
  if (userInfoRes.ok) {
    const userInfo = (await userInfoRes.json()) as { emails?: { value: string }[] };
    platformAccountId = userInfo.emails?.[0]?.value ?? null;
  }

  // ── Store in DB ────────────────────────────────────────────────────────────
  const { count: existingCount } = await supabase
    .from("instructor_payment_accounts")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", profile.id);

  const isFirstAccount = !existingCount || existingCount === 0;

  const { data: existing } = await supabase
    .from("instructor_payment_accounts")
    .select("id")
    .eq("instructor_id", profile.id)
    .eq("platform", "venmo_business")
    .single();

  if (existing) {
    await supabase
      .from("instructor_payment_accounts")
      .update({
        access_token: encryptToken(tokenData.access_token),
        refresh_token: encryptToken(tokenData.refresh_token),
        platform_account_id: platformAccountId,
        connected_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("instructor_payment_accounts").insert({
      instructor_id: profile.id,
      platform: "venmo_business",
      access_token: encryptToken(tokenData.access_token),
      refresh_token: encryptToken(tokenData.refresh_token),
      platform_account_id: platformAccountId,
      is_active: isFirstAccount,
    });
  }

  redirect("/admin/profile/payment?connected=venmo_business");
}

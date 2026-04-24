/**
 * GET /api/payments/oauth/square/callback
 * Called by: Square — redirected here after instructor grants consent
 * Auth: must be a logged-in instructor or super_admin
 * Exchanges the authorization code for tokens, fetches the Square merchant ID,
 * stores encrypted tokens in instructor_payment_accounts, redirects to payment settings.
 */

import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { encryptToken } from "@/lib/crypto";
import type { UserRole } from "@/types/users";

/** Roles permitted to connect payment accounts. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Handles the Square OAuth callback.
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
  const storedState = cookieStore.get("oauth_state_square")?.value;
  cookieStore.delete("oauth_state_square");

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
  const appId = process.env.SQUARE_APP_ID ?? "";
  const appSecret = process.env.SQUARE_APP_SECRET ?? "";
  const redirectUri = process.env.SQUARE_REDIRECT_URI ?? "";

  const tokenRes = await fetch("https://connect.squareup.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      code,
      grant_type: "authorization_code",
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
    merchant_id: string;
  };

  // Square returns the merchant_id directly in the token response
  const platformAccountId = tokenData.merchant_id ?? null;

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
    .eq("platform", "square")
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
      platform: "square",
      access_token: encryptToken(tokenData.access_token),
      refresh_token: encryptToken(tokenData.refresh_token),
      platform_account_id: platformAccountId,
      is_active: isFirstAccount,
    });
  }

  redirect("/admin/profile/payment?connected=square");
}

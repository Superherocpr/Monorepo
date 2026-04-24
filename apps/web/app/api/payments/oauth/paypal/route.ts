/**
 * GET /api/payments/oauth/paypal
 * Called by: Payment Account page — "Connect PayPal" and "Reconnect" buttons
 * Auth: instructor or super_admin only
 * Builds the PayPal Commerce Platform OAuth authorization URL and redirects
 * the instructor to PayPal's consent screen.
 * Sets a short-lived state cookie to prevent CSRF on the callback.
 */

import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import type { UserRole } from "@/types/users";

/** Roles permitted to connect payment accounts. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Initiates the PayPal OAuth flow for instructor payment account connection.
 * Generates a random state token, stores it as a cookie, then redirects.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/profile/payment");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  // Generate and store CSRF state — verified in the callback
  const state = randomBytes(32).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("oauth_state_paypal", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // 10-minute TTL — enough time to complete the OAuth flow
    maxAge: 600,
    path: "/",
  });

  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const redirectUri = process.env.PAYPAL_REDIRECT_URI ?? "";

  const url = new URL("https://www.paypal.com/connect");
  url.searchParams.set("flowEntry", "static");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "scope",
    "openid profile email https://uri.paypal.com/services/invoicing"
  );
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  redirect(url.toString());
}

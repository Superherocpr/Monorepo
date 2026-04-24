/**
 * GET /api/payments/oauth/venmo
 * Called by: Payment Account page — "Connect Venmo Business" and "Reconnect" buttons
 * Auth: instructor or super_admin only
 * Venmo Business runs on PayPal's OAuth infrastructure.
 * Builds the PayPal (Venmo) authorization URL and redirects the instructor.
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
 * Initiates the Venmo Business OAuth flow for instructor payment account connection.
 * Shares PayPal's OAuth infrastructure (PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET).
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
  cookieStore.set("oauth_state_venmo", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  // Venmo Business uses PayPal's OAuth but with Venmo-specific credentials/redirect
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const redirectUri = process.env.VENMO_REDIRECT_URI ?? "";

  const url = new URL("https://www.paypal.com/connect");
  url.searchParams.set("flowEntry", "static");
  url.searchParams.set("client_id", clientId);
  // Venmo Business scope — includes payment sending capability
  url.searchParams.set(
    "scope",
    "openid profile email https://uri.paypal.com/services/payments/sendwithvenmo"
  );
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  redirect(url.toString());
}

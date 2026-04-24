/**
 * Zoho Mail API utility for SuperheroCPR.
 * Manages OAuth token refresh and helper functions for reading/writing system_settings.
 * All functions use createAdminClient to bypass RLS on the system_settings table.
 *
 * Required environment variables:
 *   ZOHO_CLIENT_ID      — Zoho OAuth app client ID
 *   ZOHO_CLIENT_SECRET  — Zoho OAuth app client secret
 *   ZOHO_REDIRECT_URI   — e.g. https://superherocpr.com/api/contact/zoho-callback
 */

import { createAdminClient } from "@/lib/supabase/server";

// ── Low-level system_settings helpers ─────────────────────────────────────────

/**
 * Reads a single value from the system_settings table.
 * Returns null if the key does not exist.
 * @param key - The settings key to look up (e.g. "zoho_access_token").
 */
export async function getSetting(key: string): Promise<string | null> {
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? null;
}

/**
 * Writes (upserts) a value to the system_settings table.
 * @param key   - The settings key to write.
 * @param value - The value to store.
 */
export async function updateSetting(key: string, value: string): Promise<void> {
  const supabase = await createAdminClient();
  await supabase.from("system_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

// ── Zoho OAuth token management ───────────────────────────────────────────────

/**
 * Returns a valid Zoho Mail API access token.
 * If the stored token is expired (or within 60 seconds of expiry), refreshes
 * it via Zoho's token endpoint and persists the new tokens back to system_settings.
 * Throws if Zoho is not connected (no refresh token stored).
 */
export async function getZohoToken(): Promise<string> {
  const expiresAtStr = await getSetting("zoho_token_expires_at");
  const accessToken = await getSetting("zoho_access_token");

  // Use the stored token if it's valid and not about to expire within 60 seconds
  if (expiresAtStr && accessToken) {
    const expiresAt = new Date(expiresAtStr);
    const isValid = expiresAt.getTime() - Date.now() > 60_000;
    if (isValid) {
      return accessToken;
    }
  }

  // Token is expired or missing — attempt refresh
  const refreshToken = await getSetting("zoho_refresh_token");
  if (!refreshToken) {
    throw new Error("Zoho Mail is not connected. No refresh token found.");
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET env vars are not set.");
  }

  const tokenResponse = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Failed to refresh Zoho access token.");
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
    error?: string;
  };

  if (tokenData.error || !tokenData.access_token) {
    throw new Error(`Zoho token refresh error: ${tokenData.error ?? "unknown"}`);
  }

  // Persist new token and expiry
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  await Promise.all([
    updateSetting("zoho_access_token", tokenData.access_token),
    updateSetting("zoho_token_expires_at", newExpiresAt),
  ]);

  return tokenData.access_token;
}

/**
 * Fetches the Zoho Mail account ID for this OAuth user.
 * The account ID is required for all Zoho Mail API calls.
 * @param accessToken - A valid Zoho access token.
 * @returns The numeric account ID as a string.
 */
export async function fetchZohoAccountId(accessToken: string): Promise<string> {
  const response = await fetch("https://mail.zoho.com/api/accounts", {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Zoho account list.");
  }

  const json = (await response.json()) as {
    data?: { accountId: string }[];
    status?: { code: number };
  };

  const accountId = json.data?.[0]?.accountId;
  if (!accountId) {
    throw new Error("No Zoho Mail accounts found.");
  }

  return accountId;
}

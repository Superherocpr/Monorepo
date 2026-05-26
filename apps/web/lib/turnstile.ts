/**
 * lib/turnstile — Server-side verification of Cloudflare Turnstile tokens.
 * Used by: app/api/contact/route.ts (and any future captcha-gated endpoints).
 *
 * The client-side widget alone is NOT a security guard — every protected
 * endpoint must call verifyTurnstileToken() on the token submitted with the
 * form before trusting it.
 */

/** Cloudflare Turnstile token verification endpoint. */
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface VerifyResult {
  success: boolean;
  /** Error message safe to return to the client (no internals leaked). */
  error?: string;
}

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * If TURNSTILE_SECRET_KEY is not configured (e.g. local dev without a key),
 * verification is skipped and { success: true } is returned. This mirrors
 * the client widget's "render nothing" behaviour so dev environments stay
 * usable. Production deployments MUST set the secret.
 *
 * @param token - The cf-turnstile-response token submitted by the client.
 * @param remoteIp - Optional caller IP (improves Cloudflare's scoring).
 */
export async function verifyTurnstileToken(
  token: string | undefined | null,
  remoteIp?: string | null
): Promise<VerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    console.warn(
      "[turnstile] TURNSTILE_SECRET_KEY is not set — skipping captcha verification"
    );
    return { success: true };
  }

  if (!token || typeof token !== "string") {
    return { success: false, error: "Please complete the captcha." };
  }

  const formData = new URLSearchParams();
  formData.set("secret", secret);
  formData.set("response", token);
  if (remoteIp) formData.set("remoteip", remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: formData,
    });
    // Cloudflare returns 200 with { success: boolean, "error-codes": [...] }
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (!data?.success) {
      // Log the error codes server-side for debugging — do NOT leak to client
      console.warn(
        "[turnstile] Verification failed:",
        data?.["error-codes"] ?? "(no error codes)"
      );
      return { success: false, error: "Captcha verification failed. Please try again." };
    }
    return { success: true };
  } catch (err) {
    console.error("[turnstile] Network error during verification:", err);
    return { success: false, error: "Could not verify captcha. Please try again." };
  }
}

/**
 * Extracts the caller IP from a Next.js Request, preferring the leftmost
 * entry in x-forwarded-for (set by Amplify / proxies). Returns null when
 * no header is present.
 */
export function getClientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

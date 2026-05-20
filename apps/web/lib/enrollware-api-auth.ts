/**
 * Shared authentication helper for Enrollware-facing API endpoints.
 * These endpoints are called by the bookmarklet running on enrollware.com,
 * so they cannot use Supabase session cookies (cross-origin). Instead they
 * authenticate via a Bearer API key that the instructor generates once from
 * the companion admin page.
 *
 * Usage:
 *   const result = await validateEnrollwareKey(request);
 *   if (!result.ok) return result.response;
 *   const { profileId } = result;
 *
 * Server-side only. Never import this in client components.
 */

import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

/** Successful auth result. */
export interface EnrollwareAuthOk {
  ok: true;
  profileId: string;
}

/** Failed auth result — contains a ready-to-return Response. */
export interface EnrollwareAuthFail {
  ok: false;
  response: Response;
}

export type EnrollwareAuthResult = EnrollwareAuthOk | EnrollwareAuthFail;

/**
 * Validates the Bearer API key from the Authorization header against the
 * api_keys table. The raw key is never stored — only its SHA-256 hash.
 * Also checks that the associated profile is not archived or deactivated,
 * and has a staff-level role (instructor, manager, or super_admin).
 *
 * @param request - The incoming HTTP request containing the Authorization header.
 * @returns EnrollwareAuthOk with profileId if valid, or EnrollwareAuthFail with a Response.
 */
export async function validateEnrollwareKey(
  request: Request
): Promise<EnrollwareAuthResult> {
  const authHeader = request.headers.get("Authorization");
  const rawKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!rawKey) {
    return {
      ok: false,
      response: Response.json(
        { error: "Missing API key. Regenerate your bookmarklet from the SuperheroCPR admin." },
        { status: 401 }
      ),
    };
  }

  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const admin = await createAdminClient();

  // Look up the hashed key and join the profile in one query
  const { data: keyRecord } = await admin
    .from("api_keys")
    .select("profile_id, profiles ( role, archived, deactivated )")
    .eq("key_hash", keyHash)
    .eq("label", "enrollware-bookmarklet")
    .single();

  if (!keyRecord) {
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid or expired API key. Regenerate your bookmarklet from the SuperheroCPR admin." },
        { status: 401 }
      ),
    };
  }

  // keyRecord.profiles is the joined profiles row (Supabase returns it as an object or array)
  const profile = Array.isArray(keyRecord.profiles)
    ? keyRecord.profiles[0]
    : keyRecord.profiles;

  if (!profile) {
    return {
      ok: false,
      response: Response.json({ error: "Account not found." }, { status: 401 }),
    };
  }

  // Block archived or deactivated accounts from using the tool
  if (profile.archived || profile.deactivated) {
    return {
      ok: false,
      response: Response.json(
        { error: "Your account has been deactivated. Contact a manager." },
        { status: 403 }
      ),
    };
  }

  // Only staff roles may use Enrollware endpoints
  const allowedRoles = ["instructor", "manager", "super_admin"];
  if (!allowedRoles.includes(profile.role)) {
    return {
      ok: false,
      response: Response.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  // Update last_used_at so admins can see when the bookmarklet was last active
  await admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash);

  return { ok: true, profileId: keyRecord.profile_id as string };
}

/**
 * Builds CORS headers that allow cross-origin requests from any enrollware.com
 * subdomain. These are required because the bookmarklet runs on enrollware.com
 * but calls the SuperheroCPR API on a different domain.
 *
 * @param origin - The value of the request's Origin header (may be null).
 * @returns An object of CORS headers to merge into the response.
 */
export function enrollwareCorsHeaders(origin: string | null): Record<string, string> {
  // Allow any subdomain of enrollware.com (www.enrollware.com, superherocpr.enrollware.com, etc.)
  const isEnrollwareOrigin =
    origin !== null &&
    (origin === "https://www.enrollware.com" ||
      origin.endsWith(".enrollware.com"));

  return {
    "Access-Control-Allow-Origin": isEnrollwareOrigin ? origin : "https://www.enrollware.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    // Origin varies by caller — tell intermediaries not to share cached responses across origins
    Vary: "Origin",
  };
}

/**
 * The IANA timezone used as the default "today" reference for instructors when
 * the client does not send its own timezone. The business operates out of
 * Tampa, FL, so Eastern time is the correct default; this prevents the UTC
 * day-rollover bug that would otherwise cut off classes in the late evening.
 */
export const DEFAULT_INSTRUCTOR_TZ = "America/New_York";

/**
 * Computes the UTC start and end timestamps that bracket the local-calendar
 * "today" in the given IANA timezone. Used so that a query for "today's
 * classes" returns the instructor's local day, not the UTC day (which would
 * roll over hours before midnight Eastern).
 *
 * @param tz - IANA timezone name (e.g. "America/New_York"). Falls back to
 *             DEFAULT_INSTRUCTOR_TZ if the value is missing or not a valid
 *             IANA name.
 * @returns Object with ISO strings for the local day's start and end in UTC.
 */
export function localDayWindow(tz: string | null | undefined): {
  startIso: string;
  endIso: string;
  tz: string;
} {
  // Reject obviously-invalid input; Intl.DateTimeFormat throws on bad TZ names
  let safeTz = tz && typeof tz === "string" ? tz : DEFAULT_INSTRUCTOR_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: safeTz });
  } catch {
    safeTz = DEFAULT_INSTRUCTOR_TZ;
  }

  // Format "now" in the target TZ to extract that locale's calendar date parts
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");

  // Build the local-midnight Date by computing the TZ offset for that wall-clock
  // moment. We use the "shortOffset" trick to read the zone offset in minutes,
  // then convert back to a UTC instant.
  const localMidnightAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    0,
    0,
    0,
    0
  );

  // Determine the offset (in ms) between UTC and the target TZ at that local
  // midnight. Doing the round-trip via Intl ensures DST is handled correctly.
  const tzMidnight = new Date(localMidnightAsUtc);
  const tzFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(tzMidnight);

  const tgt = (t: string) => Number(tzFormatted.find((p) => p.type === t)?.value ?? "0");
  // Reconstruct what UTC ms the formatter said the wall-clock was, then diff
  // against the actual UTC ms to get the zone's offset.
  const interpretedAsUtc = Date.UTC(
    tgt("year"),
    tgt("month") - 1,
    tgt("day"),
    tgt("hour"),
    tgt("minute"),
    tgt("second")
  );
  const offsetMs = interpretedAsUtc - localMidnightAsUtc;

  const startMs = localMidnightAsUtc - offsetMs;
  // 24h-1ms window — covers the entire local calendar day
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    tz: safeTz,
  };
}

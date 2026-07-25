/**
 * Next.js proxy — runs on every matched request in the Edge Runtime.
 *
 * Responsibilities:
 * 1. Nav visibility gate — redirects disabled public pages to / before doing
 *    anything else. Reads nav_<page>_enabled flags from system_settings via
 *    the Supabase REST API. Fails open (allows access) if the DB is unreachable.
 *    /book/forgot-password and /book/reset-password are always exempt so
 *    password-reset emails keep working even when Schedule is disabled.
 *
 * 2. Session refresh — refreshes the Supabase session before any Server
 *    Component renders. Server Components cannot write cookies, so the proxy
 *    is the only place the @supabase/ssr client can persist a refreshed token.
 *    Without this, expired sessions cause auth.getUser() to return null and
 *    loop users to /signin.
 *
 * Pattern: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── Nav visibility gate ────────────────────────────────────────────────────────

/** Maps each toggleable public path prefix to its system_settings key. */
const NAV_PROTECTED: { prefix: string; settingKey: string }[] = [
  { prefix: "/classes", settingKey: "nav_classes_enabled" },
  { prefix: "/book",    settingKey: "nav_schedule_enabled" },
  { prefix: "/merch",   settingKey: "nav_merch_enabled" },
  { prefix: "/blog",    settingKey: "nav_blog_enabled" },
  { prefix: "/about",   settingKey: "nav_about_enabled" },
  { prefix: "/contact", settingKey: "nav_contact_enabled" },
];

/** /book sub-paths that remain accessible even when Schedule is disabled. */
const BOOK_EXEMPTIONS = ["/book/forgot-password", "/book/reset-password"];

/**
 * Returns false when the given system_settings key is explicitly set to "false".
 * Returns true for any other value, a missing row, or on any error (fail open).
 * Uses the service role key so RLS on system_settings is bypassed.
 * @param settingKey - The system_settings.key to look up.
 */
async function isNavEnabled(settingKey: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return true;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/system_settings?key=eq.${settingKey}&select=value`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) return true;
    const rows = (await res.json()) as { value: string }[];
    return !rows.length || rows[0].value !== "false";
  } catch {
    return true;
  }
}

// ── Proxy entry point ──────────────────────────────────────────────────────────

/**
 * Handles nav gating then refreshes the Supabase session on every request so
 * server-side auth checks always operate on a valid, up-to-date session cookie.
 * @param request - The incoming Next.js edge request.
 * @returns A redirect response if the nav page is disabled, or the response with
 *          refreshed session cookies set.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── 1. Nav visibility gate ────────────────────────────────────────────────
  const isBookExempt = BOOK_EXEMPTIONS.some(
    (ex) => pathname === ex || pathname.startsWith(`${ex}/`)
  );

  if (!isBookExempt) {
    for (const { prefix, settingKey } of NAV_PROTECTED) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        const enabled = await isNavEnabled(settingKey);
        if (!enabled) {
          return NextResponse.redirect(new URL("/", request.url));
        }
        break;
      }
    }
  }

  // ── 2. Session refresh ────────────────────────────────────────────────────
  // Start with a pass-through response. The Supabase client may replace this
  // with a new response object if it needs to write refreshed cookies.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write the refreshed tokens to the request (so downstream proxy
          // can read them) and to the response (so the browser receives them).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Calling getUser() triggers the token refresh if the access token has expired.
  // The return value is intentionally unused — auth guards in individual layouts
  // handle the actual redirect logic.
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run on all routes except Next.js internals and static assets.
     * Auth state must be refreshed before any page render, so the matcher
     * is intentionally broad.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

/**
 * Next.js middleware — runs on every matched request in the Edge Runtime.
 * Primary responsibility: refresh the Supabase session before any Server Component renders.
 *
 * Why this is required:
 * Server Components cannot write cookies (they are read-only in the render phase).
 * When a Supabase access token expires, the @supabase/ssr client needs to write a
 * refreshed token back to the cookie jar. The only place it can do this reliably is
 * middleware, which runs in the Edge Runtime where response cookies are writable.
 * Without this file, expired sessions cause auth.getUser() to return null on the
 * server — making every protected layout think the user is logged out and redirect
 * them back to /signin, creating an infinite redirect loop.
 *
 * Pattern: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request so server-side auth checks
 * always operate on a valid, up-to-date session cookie.
 * @param request - The incoming Next.js edge request.
 * @returns The response with refreshed session cookies set.
 */
export async function middleware(request: NextRequest) {
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
          // Write the refreshed tokens to the request (so downstream middleware
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

  // Calling getUser() is what triggers the token refresh if the access token
  // has expired. The return value is intentionally unused here — the auth
  // guards in individual layouts handle the actual redirect logic.
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

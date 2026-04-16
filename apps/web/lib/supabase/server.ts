/**
 * Server-side Supabase client for use in Server Components and API routes.
 * Uses @supabase/ssr to read/write cookies for session management.
 * DO NOT import this in any "use client" component — use lib/supabase/client.ts instead.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Creates a Supabase client bound to the current request's cookie store.
 * Uses the anon key by default; RLS applies to all queries.
 * For admin operations that bypass RLS, pass the service role key explicitly
 * via environment variables in the calling API route.
 * @returns A Supabase client configured for server-side use.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from a Server Component during a read-only render.
            // This is safe to ignore — the middleware handles session refresh.
          }
        },
      },
    }
  );
}

/**
 * Creates a Supabase client using the service role key.
 * Bypasses Row Level Security — use only in trusted admin API routes.
 * NEVER use this in any client component or expose the service role key to the browser.
 * @returns A Supabase admin client with full database access.
 */
export async function createAdminClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Safe to ignore in read-only render contexts.
          }
        },
      },
    }
  );
}

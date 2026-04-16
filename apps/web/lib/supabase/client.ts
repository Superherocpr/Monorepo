/**
 * Browser-side Supabase client for use in "use client" components.
 * Uses @supabase/ssr to sync sessions with server-managed cookies.
 * DO NOT import this in Server Components or API routes — use lib/supabase/server.ts instead.
 */
import { createBrowserClient } from "@supabase/ssr";

/**
 * Creates a Supabase client for use in client components.
 * Reads the anon key — RLS applies to all queries.
 * @returns A Supabase client configured for browser-side use.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

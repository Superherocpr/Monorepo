"use client";

/**
 * /signin — Standalone sign-in page for direct access (e.g. header button, redirect links).
 * After successful authentication, redirects to the `redirect` query param or /dashboard.
 * Not part of the booking flow — does not read/write the booking store.
 * Used by: PublicHeader Sign In button, dashboard auth guards.
 */

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Inner form component — requires Suspense boundary for useSearchParams. */
function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect to dashboard if already signed in
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace("/dashboard");
    });
  }, [router]);

  /**
   * Submits credentials to Supabase auth.
   * On success, routes to the `redirect` param or /dashboard.
   * On failure, shows an inline error without clearing the form.
   */
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !data.user) {
      setError(
        authError?.message ?? "Sign-in failed. Please check your credentials."
      );
      setLoading(false);
      return;
    }

    // Honour an explicit redirect param, fall back to the dashboard
    const redirectTo = searchParams.get("redirect") ?? "/dashboard";
    router.push(redirectTo);
  }

  return (
    <form onSubmit={handleSignIn} noValidate className="flex flex-col gap-5">
      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signin-email" className="text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="signin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-required="true"
          autoComplete="email"
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          placeholder="you@example.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signin-password" className="text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-required="true"
          autoComplete="current-password"
          className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        {loading ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}

/** Renders the standalone sign-in page with email/password form. */
export default function SignInPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign In</h1>
        <p className="text-gray-500 text-sm mb-8">
          Welcome back. Sign in to access your dashboard.
        </p>

        {/* Suspense required by Next.js for useSearchParams in a client component */}
        <Suspense>
          <SignInForm />
        </Suspense>

        <p className="mt-6 text-sm text-gray-500">
          Don&apos;t have an account?{" "}
          <Link
            href="/book"
            className="text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
          >
            Book a class to get started
          </Link>
        </p>
      </div>
    </div>
  );
}

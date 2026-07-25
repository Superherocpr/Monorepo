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
  const [showPassword, setShowPassword] = useState(false);

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

    // Fetch the user's role so staff are routed to the admin panel instead of
    // the customer dashboard — which would loop if they have no customer profile.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    const staffRoles = ["instructor", "manager", "super_admin", "inspector"];
    const isStaff = profile?.role && staffRoles.includes(profile.role);

    // Staff always go to /admin. Non-staff honour the redirect param.
    const redirectTo = isStaff
      ? "/admin"
      : (searchParams.get("redirect") ?? "/dashboard");
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
        <div className="flex items-center justify-between">
          <label htmlFor="signin-password" className="text-sm font-medium text-gray-700">
            Password
          </label>
          <Link
            href="/book/forgot-password"
            className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <input
            id="signin-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-required="true"
            autoComplete="current-password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            placeholder="••••••••"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
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

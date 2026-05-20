"use client";

/**
 * /book/forgot-password — Password reset request page.
 * Linked from the rollcall sign-in form ("Forgot password?") and the sign-in page.
 * Accepts the user's email address and triggers a branded password-reset email
 * via POST /api/auth/reset-password (server-side Resend, not Supabase's default template).
 * On success, shows a confirmation message asking the user to check their inbox.
 * The reset email links to /book/reset-password where the new password is set.
 * Used by: app/(public)/rollcall/page.tsx, app/(public)/signin/page.tsx
 */

import { useState } from "react";
import Link from "next/link";

/**
 * Renders a form for requesting a password-reset email.
 * Calls supabase.auth.resetPasswordForEmail() with a redirectTo pointing to
 * /book/reset-password so customers land in the right flow after clicking the link.
 * Always shows a success message regardless of whether the email exists — this
 * prevents account-enumeration attacks where an attacker could probe for valid emails.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Submits the email to POST /api/auth/reset-password, which generates a
   * Supabase recovery link server-side and sends our branded email via Resend.
   * Always shows a success message regardless of whether the account exists —
   * this prevents account enumeration.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);

    await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {/* non-fatal — always show success */});

    setLoading(false);

    // Always show success to prevent account enumeration.
    setSubmitted(true);
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Check Your Email</h1>
          <p className="text-gray-500 text-sm mb-6">
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a link
            to reset your password. It may take a minute or two to arrive.
          </p>
          <p className="text-sm text-gray-500">
            <Link
              href="/signin"
              className="text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ── Request form ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Reset Password</h1>
        <p className="text-gray-500 text-sm mb-8">
          Enter the email address on your account and we&apos;ll send you a reset link.
        </p>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          {error && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="reset-email"
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {loading ? "Sending…" : "Send Reset Link"}
          </button>
        </form>

        <p className="mt-6 text-sm text-gray-500">
          Remembered it?{" "}
          <Link
            href="/signin"
            className="text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

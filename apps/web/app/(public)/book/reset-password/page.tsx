"use client";

/**
 * /book/reset-password — Customer password reset completion page.
 * Reached by clicking the reset link sent by /book/forgot-password.
 * Supabase appends a URL hash with a recovery access_token and refresh_token.
 * This page exchanges those tokens for a live session, then lets the customer
 * choose a new password. On success, redirects to /dashboard.
 * Used by: Supabase password-reset email (redirectTo in resetPasswordForEmail).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Possible UI states for the reset flow. */
type Status = "loading" | "ready" | "error" | "submitting" | "done";

/**
 * Reads the Supabase recovery hash from the URL on mount, establishes a session,
 * and renders a new-password form for the customer.
 * After the password is updated, redirects the customer to their dashboard.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // On mount: extract the recovery tokens Supabase places in the URL hash and
  // exchange them for a live session. The hash is never sent to the server, so
  // this exchange must happen client-side.
  useEffect(() => {
    async function exchangeToken() {
      const hash = window.location.hash.slice(1); // strip leading #

      if (!hash) {
        setLinkError(
          "This link is invalid or has already been used. Request a new one below."
        );
        setStatus("error");
        return;
      }

      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const tokenType = params.get("type");

      // Only accept recovery-type tokens — reject invite or other flows here.
      if (!accessToken || !refreshToken || tokenType !== "recovery") {
        setLinkError(
          "This link is invalid or has already been used. Request a new one below."
        );
        setStatus("error");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        setLinkError(
          "This reset link has expired. Please request a new one."
        );
        setStatus("error");
        return;
      }

      // Remove tokens from the address bar so they aren't visible or re-used.
      window.history.replaceState(null, "", window.location.pathname);
      setStatus("ready");
    }

    exchangeToken();
  }, []);

  /**
   * Validates the new password and updates it via Supabase.
   * On success, redirects the customer to their dashboard.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setFormError("Passwords do not match.");
      return;
    }

    setStatus("submitting");

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setFormError(error.message ?? "Failed to update password. Please try again.");
      setStatus("ready");
      return;
    }

    setStatus("done");
    router.push("/dashboard");
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex items-center gap-3 text-gray-500 text-sm">
          <span className="animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent shrink-0" />
          Verifying reset link…
        </div>
      </div>
    );
  }

  // ── Error state (invalid or expired link) ──────────────────────────────────
  if (status === "error") {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Link Expired</h1>
          <p className="text-gray-500 text-sm mb-4">{linkError}</p>
          <Link
            href="/book/forgot-password"
            className="text-red-600 hover:text-red-700 font-medium text-sm transition-colors duration-150"
          >
            Request a new reset link →
          </Link>
        </div>
      </div>
    );
  }

  // ── New password form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Choose a New Password</h1>
        <p className="text-gray-500 text-sm mb-8">
          Pick something secure — at least 8 characters.
        </p>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
          {formError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
            >
              {formError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-password" className="text-sm font-medium text-gray-700">
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-required="true"
              autoComplete="new-password"
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              aria-required="true"
              autoComplete="new-password"
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {status === "submitting" ? "Saving…" : "Set New Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

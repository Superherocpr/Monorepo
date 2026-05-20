"use client";

/**
 * /setup-password — Staff account password setup page.
 * Reached via the invite email link sent to new staff members by an admin.
 * Reads the Supabase recovery token from the URL hash, establishes a live session,
 * then lets the user choose a permanent password for their account.
 * After setting the password, redirects to /admin/profile/payment.
 * Used by: staff invite flow (POST /api/staff/invite).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Possible states for the setup flow. */
type Status = "loading" | "ready" | "error" | "submitting";

/**
 * Reads the Supabase recovery hash from the URL on mount, establishes a session,
 * and renders a password setup form for new staff members.
 * On success, routes the user directly into the admin panel.
 */
export default function SetupPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // On mount: extract tokens from the URL hash and exchange them for a session.
  // Supabase appends #access_token=...&refresh_token=...&type=recovery after
  // verifying the invite link. This must be done client-side since the hash is
  // never sent to the server.
  useEffect(() => {
    async function exchangeToken() {
      const hash = window.location.hash.slice(1); // strip leading #

      if (!hash) {
        setLinkError("This link is invalid or has already been used.");
        setStatus("error");
        return;
      }

      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (!accessToken || !refreshToken) {
        setLinkError("This link is invalid or has already been used.");
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
          "This invite link has expired. Please ask an admin to send a new invite."
        );
        setStatus("error");
        return;
      }

      // Remove tokens from the address bar so they aren't visible or bookmarked.
      window.history.replaceState(null, "", window.location.pathname);
      setStatus("ready");
    }

    exchangeToken();
  }, []);

  /**
   * Validates the form, sets the user's permanent password via Supabase,
   * and redirects to the payment settings page in the admin panel.
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
      setFormError(error.message ?? "Failed to set password. Please try again.");
      setStatus("ready");
      return;
    }

    // Session is already live — route directly into the admin panel.
    router.push("/admin/profile/payment");
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8 flex items-center gap-3 text-gray-500 text-sm">
          <span className="animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent shrink-0" />
          Verifying your invite link…
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
          <p className="text-sm text-gray-500">
            Contact{" "}
            <a
              href="mailto:contact@superherocpr.com"
              className="text-red-600 hover:underline"
            >
              contact@superherocpr.com
            </a>{" "}
            if you need a new invite.
          </p>
        </div>
      </div>
    );
  }

  // ── Password setup form ────────────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Set Your Password</h1>
        <p className="text-gray-500 text-sm mb-8">
          Choose a password to activate your Superhero CPR staff account.
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
            <label
              htmlFor="new-password"
              className="text-sm font-medium text-gray-700"
            >
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
              minLength={8}
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              placeholder="••••••••"
            />
            <p className="text-xs text-gray-400">Minimum 8 characters</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="confirm-password"
              className="text-sm font-medium text-gray-700"
            >
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
            {status === "submitting" ? "Setting password…" : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

/**
 * /book/signin — Step 2a of the booking wizard: existing customer sign-in.
 * Authenticates via Supabase, writes customerId to the booking store,
 * and routes to /book/payment on success.
 * Used by: booking flow when a non-authenticated user selects a session.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getBookingStore, setBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import type { BookingStore } from "@/lib/booking-store";

/** Renders the sign-in step of the booking wizard. */
export default function BookSignInPage() {
  const router = useRouter();
  // Initialize session details from store on first render (avoids set-state-in-effect).
  const [sessionDetails] = useState<BookingStore["sessionDetails"]>(() => getBookingStore().sessionDetails);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Guard: redirect to /book if no session is selected
  useEffect(() => {
    if (!getBookingStore().sessionId) router.replace("/book");
  }, [router]);

  /**
   * Submits sign-in credentials to Supabase.
   * On success, updates the booking store and routes to payment.
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
      setError(authError?.message ?? "Sign-in failed. Please check your credentials.");
      setLoading(false);
      return;
    }

    setBookingStore({ customerId: data.user.id, isNewCustomer: false });
    router.push("/book/payment");
  }

  return (
    <div className="min-h-screen bg-white">
      <BookingProgress currentStep={2} />

      <div className="max-w-5xl mx-auto px-4 pb-16">
        <div className="flex flex-col lg:flex-row gap-10">

          {/* ── Left: sign-in form ── */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Sign In</h1>
            <p className="text-gray-500 text-sm mb-8">
              Already have an account? Sign in to continue booking.
            </p>

            <form onSubmit={handleSignIn} noValidate className="flex flex-col gap-5">

              {/* Inline error */}
              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
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

            <p className="mt-6 text-sm text-gray-500">
              Don&apos;t have an account?{" "}
              <Link
                href="/book/details"
                className="text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
              >
                Continue as new customer
              </Link>
            </p>
          </div>

          {/* ── Right: order summary ── */}
          <div className="w-full lg:w-80 shrink-0">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Your Selection
            </h2>
            <OrderSummary details={sessionDetails} />
          </div>
        </div>
      </div>
    </div>
  );
}

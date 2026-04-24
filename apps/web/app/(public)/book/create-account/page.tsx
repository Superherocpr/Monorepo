"use client";

/**
 * /book/create-account — Step 3 of the booking wizard: new customer sets a password.
 * Creates a Supabase auth user, inserts a profile record, sends a welcome email,
 * updates the booking store, and routes to /book/payment.
 * Used by: booking flow after /book/details for new customers.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getBookingStore, setBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import type { BookingStore } from "@/lib/booking-store";

/** Calculates password strength: 'weak' | 'good' | 'strong'. */
function getPasswordStrength(password: string): "weak" | "good" | "strong" {
  if (password.length < 8) return "weak";
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  if (score >= 3) return "strong";
  if (score >= 2) return "good";
  return "weak";
}

const STRENGTH_LABELS = {
  weak: "Weak",
  good: "Good",
  strong: "Strong",
};

const STRENGTH_COLORS = {
  weak: "text-red-500",
  good: "text-amber-500",
  strong: "text-green-600",
};

/** Renders the password-creation step for new customers (Step 3). */
export default function BookCreateAccountPage() {
  const router = useRouter();
  const [sessionDetails, setSessionDetails] = useState<BookingStore["sessionDetails"]>(null);
  const [customerDetails, setCustomerDetails] = useState<BookingStore["customerDetails"]>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = password ? getPasswordStrength(password) : null;

  // Guards: redirect if required prior steps are incomplete
  useEffect(() => {
    const store = getBookingStore();
    if (!store.sessionId) {
      router.replace("/book");
      return;
    }
    if (!store.customerDetails) {
      router.replace("/book/details");
      return;
    }
    setSessionDetails(store.sessionDetails);
    setCustomerDetails(store.customerDetails);
  }, [router]);

  /**
   * Creates the Supabase auth user, inserts the profile row,
   * sends a welcome email, and routes to payment.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!customerDetails) {
      router.replace("/book/details");
      return;
    }

    setLoading(true);

    const supabase = createClient();

    // Step 1: Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: customerDetails.email,
      password,
    });

    if (authError || !authData.user) {
      setError(authError?.message ?? "Failed to create account. Please try again.");
      setLoading(false);
      return;
    }

    // Step 2: Insert profile record with customer details
    const { error: profileError } = await supabase
      .from("profiles")
      .insert({
        id: authData.user.id,
        first_name: customerDetails.firstName,
        last_name: customerDetails.lastName,
        email: customerDetails.email,
        phone: customerDetails.phone,
        address: customerDetails.address,
        city: customerDetails.city,
        state: customerDetails.state,
        zip: customerDetails.zip,
        role: "customer",
      });

    if (profileError) {
      setError("Account was created but we couldn't save your details. Please contact support.");
      setLoading(false);
      return;
    }

    // Step 3: Send welcome email (best-effort — don't block on failure)
    await fetch("/api/emails/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: customerDetails.firstName,
        email: customerDetails.email,
      }),
    }).catch(() => {
      // Welcome email failure is non-fatal — customer can still proceed
    });

    // Step 4: Update the booking store with the new customer's ID
    setBookingStore({ customerId: authData.user.id });

    router.push("/book/payment");
  }

  return (
    <div className="min-h-screen bg-white">
      <BookingProgress currentStep={3} />

      <div className="max-w-5xl mx-auto px-4 pb-16">
        <div className="flex flex-col lg:flex-row gap-10">

          {/* ── Left: account creation form ── */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Create Your Account</h1>

            {/* Confirmation display — shows who we're creating the account for */}
            {customerDetails && (
              <p className="text-gray-500 text-sm mb-8">
                Creating account for{" "}
                <span className="font-semibold text-gray-700">
                  {customerDetails.firstName} {customerDetails.lastName}
                </span>{" "}
                ({customerDetails.email})
                {" — "}
                <Link
                  href="/book/details"
                  className="text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
                >
                  ← Edit your details
                </Link>
              </p>
            )}

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">

              {/* Inline error */}
              {error && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-required="true"
                  autoComplete="new-password"
                  minLength={8}
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Minimum 8 characters"
                />
                {/* Password strength indicator */}
                {strength && (
                  <p
                    aria-live="polite"
                    className={`text-xs font-medium ${STRENGTH_COLORS[strength]}`}
                  >
                    Strength: {STRENGTH_LABELS[strength]}
                  </p>
                )}
              </div>

              {/* Confirm password */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">
                  Confirm password <span className="text-red-500">*</span>
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  aria-required="true"
                  autoComplete="new-password"
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Re-enter your password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 mt-2"
              >
                {loading ? "Creating account…" : "Create Account & Continue"}
              </button>
            </form>
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

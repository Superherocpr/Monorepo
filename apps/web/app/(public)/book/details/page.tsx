"use client";

/**
 * /book/details — Step 2 of the booking wizard: collect name, email, and phone.
 * Checks whether the email or phone belongs to an existing account. If so,
 * redirects to /book/signin (passing their email as a URL param for pre-fill).
 * New customers are stored and routed directly to /book/payment.
 * Used by: booking flow for all non-authenticated users.
 */

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getBookingStore, setBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import type { BookingStore } from "@/lib/booking-store";

interface DetailsForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: DetailsForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

/** Renders the customer info form (Step 2) — collects name, email, and phone. */
export default function BookDetailsPage() {
  const router = useRouter();
  // Initialize from store on first render so back-navigation pre-populates.
  const [sessionDetails] = useState<BookingStore["sessionDetails"]>(() => getBookingStore().sessionDetails);
  const [form, setForm] = useState<DetailsForm>(() => {
    const stored = getBookingStore().customerDetails;
    return stored
      ? { firstName: stored.firstName, lastName: stored.lastName, email: stored.email, phone: stored.phone }
      : EMPTY_FORM;
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof DetailsForm, string>>>({});
  const [loading, setLoading] = useState(false);

  // Guard: redirect to /book if no session is selected.
  useEffect(() => {
    if (!getBookingStore().sessionId) router.replace("/book");
  }, [router]);

  // sessionStorage doesn't exist during SSR, so the server always renders
  // OrderSummary's loading skeleton. useSyncExternalStore is the hydration-safe
  // way to read a client-only value: the server snapshot (false) renders
  // first, then the real value swaps in, avoiding a hydration mismatch.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  /** Updates a single form field and clears its error. */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  /** Returns true when all required fields pass basic validation. */
  function validate(): boolean {
    const errors: Partial<Record<keyof DetailsForm, string>> = {};
    if (!form.firstName.trim()) errors.firstName = "First name is required.";
    if (!form.lastName.trim()) errors.lastName = "Last name is required.";
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errors.email = "A valid email is required.";
    if (!form.phone.trim()) errors.phone = "Phone number is required.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Validates the form, then checks for an existing account by email (primary)
   * and phone (secondary). If a match is found, redirects to /book/signin with
   * the email pre-filled. Otherwise saves details and routes to /book/payment.
   */
  async function handleContinue(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    const supabase = createClient();
    const normalizedEmail = form.email.trim().toLowerCase();
    const normalizedPhone = form.phone.trim();

    // Primary check: email
    const { data: byEmail } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (byEmail) {
      router.push(`/book/signin?email=${encodeURIComponent(normalizedEmail)}`);
      return;
    }

    // Secondary check: phone
    const { data: byPhone } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (byPhone) {
      router.push(`/book/signin?email=${encodeURIComponent(normalizedEmail)}`);
      return;
    }

    // New customer — save details and go straight to payment. Clear any
    // customerId left over from earlier in this session (e.g. a prior sign-in
    // or account creation for different details); otherwise the payment page
    // would treat this fresh identity as already having an account.
    setBookingStore({
      customerDetails: {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
      },
      isNewCustomer: true,
      customerId: null,
    });
    router.push("/book/payment");
  }

  return (
    <div className="min-h-screen bg-white">
      <BookingProgress currentStep={2} />

      <div className="max-w-5xl mx-auto px-4 pb-16">
        <div className="flex flex-col lg:flex-row gap-10">

          {/* Left: details form */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Your Information</h1>
            <p className="text-gray-500 text-sm mb-8">
              Enter your name and contact info to reserve your spot.
            </p>

            <form onSubmit={handleContinue} noValidate className="flex flex-col gap-5">

              {/* Name row */}
              <div className="flex flex-col sm:flex-row gap-4">
                <FormField
                  id="firstName"
                  label="First name"
                  value={form.firstName}
                  onChange={handleChange}
                  error={fieldErrors.firstName}
                  required
                  autoComplete="given-name"
                />
                <FormField
                  id="lastName"
                  label="Last name"
                  value={form.lastName}
                  onChange={handleChange}
                  error={fieldErrors.lastName}
                  required
                  autoComplete="family-name"
                />
              </div>

              <FormField
                id="email"
                label="Email"
                type="email"
                value={form.email}
                onChange={handleChange}
                error={fieldErrors.email}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />

              <FormField
                id="phone"
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={handleChange}
                error={fieldErrors.phone}
                required
                autoComplete="tel"
                placeholder="(555) 000-0000"
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 mt-2"
              >
                {loading ? "Checking…" : "Continue"}
              </button>
            </form>

            <p className="mt-6 text-sm text-gray-500">
              Already have an account?{" "}
              <Link
                href="/book/signin"
                className="text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
              >
                Sign in instead
              </Link>
            </p>
          </div>

          {/* Right: order summary */}
          <div className="w-full lg:w-80 shrink-0">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Your Selection
            </h2>
            <OrderSummary details={mounted ? sessionDetails : null} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Form Field Helper ─────────────────────────────────────────────────────────

interface FormFieldProps {
  id: keyof DetailsForm;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}

/** Labeled text input with optional error message. */
function FormField({
  id,
  label,
  value,
  onChange,
  error,
  required,
  type = "text",
  autoComplete,
  placeholder,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 flex-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        aria-required={required ? "true" : undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className={[
          "border rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent",
          error ? "border-red-400" : "border-gray-300",
        ].join(" ")}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600 mt-0.5">{error}</p>
      )}
    </div>
  );
}

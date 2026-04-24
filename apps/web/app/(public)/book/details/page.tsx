"use client";

/**
 * /book/details — Step 2b of the booking wizard: new customer enters their info.
 * Collects personal details, checks for duplicate email accounts, persists to store,
 * and routes to /book/create-account.
 * Used by: booking flow for new customers who don't have an account.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getBookingStore, setBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import type { BookingStore } from "@/lib/booking-store";

/** US state abbreviations for the state dropdown. */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

interface DetailsForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_FORM: DetailsForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
};

/** Renders the customer details form for new customers (Step 2b). */
export default function BookDetailsPage() {
  const router = useRouter();
  const [sessionDetails, setSessionDetails] = useState<BookingStore["sessionDetails"]>(null);
  const [form, setForm] = useState<DetailsForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof DetailsForm, string>>>({});
  const [loading, setLoading] = useState(false);

  // Guard: redirect to /book if no session is selected.
  // Pre-populate from store if customer is navigating back from Step 3.
  useEffect(() => {
    const store = getBookingStore();
    if (!store.sessionId) {
      router.replace("/book");
      return;
    }
    setSessionDetails(store.sessionDetails);
    if (store.customerDetails) {
      setForm(store.customerDetails);
    }
  }, [router]);

  /** Updates a single form field. */
  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Clear field-level error when user edits
    setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  /** Validates the form and returns true if all required fields are filled. */
  function validate(): boolean {
    const errors: Partial<Record<keyof DetailsForm, string>> = {};
    if (!form.firstName.trim()) errors.firstName = "First name is required.";
    if (!form.lastName.trim()) errors.lastName = "Last name is required.";
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) errors.email = "A valid email is required.";
    if (!form.phone.trim()) errors.phone = "Phone number is required.";
    if (!form.address.trim()) errors.address = "Address is required.";
    if (!form.city.trim()) errors.city = "City is required.";
    if (!form.state) errors.state = "State is required.";
    if (!form.zip.trim()) errors.zip = "ZIP code is required.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Validates the form, checks for duplicate email, then stores details and routes forward.
   * Shows an inline message with a sign-in link if the email is already registered.
   */
  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", form.email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      setFieldErrors((prev) => ({
        ...prev,
        email: "An account with this email already exists.",
      }));
      setError("duplicate");
      setLoading(false);
      return;
    }

    setBookingStore({ customerDetails: form, isNewCustomer: true });
    router.push("/book/create-account");
  }

  return (
    <div className="min-h-screen bg-white">
      <BookingProgress currentStep={2} />

      <div className="max-w-5xl mx-auto px-4 pb-16">
        <div className="flex flex-col lg:flex-row gap-10">

          {/* ── Left: details form ── */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Your Details</h1>
            <p className="text-gray-500 text-sm mb-8">
              We&apos;ll use this information to create your account and issue your certification.
            </p>

            {/* Duplicate email banner */}
            {error === "duplicate" && (
              <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm mb-6">
                An account with this email already exists.{" "}
                <Link href="/book/signin" className="font-semibold underline hover:text-amber-900">
                  Please sign in instead.
                </Link>
              </div>
            )}

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

              <FormField
                id="address"
                label="Street address"
                value={form.address}
                onChange={handleChange}
                error={fieldErrors.address}
                required
                autoComplete="street-address"
                hint="Used for your certification record"
              />

              {/* City / State / ZIP row */}
              <div className="flex flex-col sm:flex-row gap-4">
                <FormField
                  id="city"
                  label="City"
                  value={form.city}
                  onChange={handleChange}
                  error={fieldErrors.city}
                  required
                  autoComplete="address-level2"
                />

                <div className="flex flex-col gap-1.5 flex-1">
                  <label htmlFor="state" className="text-sm font-medium text-gray-700">
                    State <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="state"
                    name="state"
                    value={form.state}
                    onChange={handleChange}
                    required
                    aria-required="true"
                    autoComplete="address-level1"
                    className={[
                      "border rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent",
                      fieldErrors.state ? "border-red-400" : "border-gray-300",
                    ].join(" ")}
                  >
                    <option value="">Select…</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {fieldErrors.state && (
                    <p role="alert" className="text-xs text-red-600 mt-0.5">{fieldErrors.state}</p>
                  )}
                </div>

                <FormField
                  id="zip"
                  label="ZIP"
                  value={form.zip}
                  onChange={handleChange}
                  error={fieldErrors.zip}
                  required
                  autoComplete="postal-code"
                  placeholder="33601"
                  className="max-w-[110px]"
                />
              </div>

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
  hint?: string;
  className?: string;
}

/**
 * Renders a labeled text input with optional error message and hint text.
 * Used internally by the details form.
 */
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
  hint,
  className = "",
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 flex-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {hint && <p className="text-xs text-gray-400 -mt-1">{hint}</p>}
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

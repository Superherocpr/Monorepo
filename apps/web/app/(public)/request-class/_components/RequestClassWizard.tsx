"use client";

/**
 * RequestClassWizard — single-page class request flow with inline auth gate.
 * Flow: user fills out the request → clicks submit → if already authenticated,
 * the request is submitted immediately; if not, an inline auth gate slides in
 * letting them create an account or sign in, after which the request submits.
 * Form state is held in component state so it survives the auth transition.
 * Used by: app/(public)/request-class/page.tsx
 */

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { PreferredTimeOfDay, CreateClassRequestBody } from "@/types/class-requests";
import { PREFERRED_TIME_LABELS } from "@/types/class-requests";

/** A class type option as fetched by the parent server component. */
export interface ClassTypeOption {
  id: string;
  name: string;
  duration_minutes: number;
}

interface Props {
  classTypes: ClassTypeOption[];
}

type View = "form" | "auth" | "success";
type AuthMode = "create" | "signin";

interface FormState {
  class_type_id: string;
  preferred_date: string;
  preferred_time_of_day: PreferredTimeOfDay | "";
  group_size: string;
  venue_name: string;
  venue_address: string;
  venue_city: string;
  venue_state: string;
  venue_zip: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  class_type_id: "",
  preferred_date: "",
  preferred_time_of_day: "",
  group_size: "",
  venue_name: "",
  venue_address: "",
  venue_city: "",
  venue_state: "",
  venue_zip: "",
  notes: "",
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

/** Returns the ISO date string (YYYY-MM-DD) for 7 days from now. */
function getMinDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split("T")[0];
}

/** Calculates password strength: 'weak' | 'good' | 'strong'. */
function getPasswordStrength(password: string): "weak" | "good" | "strong" {
  if (password.length < 8) return "weak";
  const score = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password)
  ).length;
  if (score >= 3) return "strong";
  if (score >= 2) return "good";
  return "weak";
}

const STRENGTH_COLORS = {
  weak: "text-red-500",
  good: "text-amber-500",
  strong: "text-green-600",
};

/**
 * Renders the full request-a-class flow: form → (optional auth gate) → success.
 * @param classTypes - Active class types fetched server-side for the dropdown.
 */
export default function RequestClassWizard({ classTypes }: Props) {
  const [view, setView] = useState<View>("form");
  const [authMode, setAuthMode] = useState<AuthMode>("create");
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Request form state ─────────────────────────────────────────────────────
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // ── Create account state ───────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const passwordStrength = createPassword ? getPasswordStrength(createPassword) : null;

  // ── Sign-in state ──────────────────────────────────────────────────────────
  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signinErrors, setSigninErrors] = useState<Record<string, string>>({});

  // ── Form field helpers ─────────────────────────────────────────────────────

  /** Updates a single form field and clears its inline error. */
  function handleFormChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ): void {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  /** Validates all request form fields; returns true if valid. */
  function validateForm(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.class_type_id) errors.class_type_id = "Please select a class type.";
    if (!form.preferred_date) {
      errors.preferred_date = "Please select a preferred date.";
    } else if (form.preferred_date < getMinDate()) {
      errors.preferred_date = "Date must be at least 7 days from today.";
    }
    if (!form.preferred_time_of_day)
      errors.preferred_time_of_day = "Please select a time preference.";
    const size = parseInt(form.group_size, 10);
    if (!form.group_size || isNaN(size) || size < 1)
      errors.group_size = "Please enter an estimated group size of at least 1.";
    if (!form.venue_name.trim()) errors.venue_name = "Venue name is required.";
    if (!form.venue_address.trim()) errors.venue_address = "Street address is required.";
    if (!form.venue_city.trim()) errors.venue_city = "City is required.";
    if (!form.venue_state) errors.venue_state = "State is required.";
    if (!form.venue_zip.trim()) errors.venue_zip = "ZIP code is required.";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // ── Core submission ────────────────────────────────────────────────────────

  /**
   * POSTs the completed request form to the API.
   * Called after auth is confirmed (or if already authenticated).
   * Throws on API error so callers can set a global error message.
   */
  async function submitRequest(): Promise<void> {
    const payload: CreateClassRequestBody = {
      class_type_id: form.class_type_id,
      preferred_date: form.preferred_date,
      preferred_time_of_day: form.preferred_time_of_day as PreferredTimeOfDay,
      group_size: parseInt(form.group_size, 10),
      venue_name: form.venue_name.trim(),
      venue_address: form.venue_address.trim(),
      venue_city: form.venue_city.trim(),
      venue_state: form.venue_state,
      venue_zip: form.venue_zip.trim(),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };

    const res = await fetch("/api/class-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = (await res.json()) as { data?: unknown; error?: string };
    if (!res.ok) throw new Error(json.error ?? "Failed to submit request");
    setView("success");
  }

  /**
   * Handles the request form submit.
   * Validates fields, checks auth, and either submits directly (authenticated)
   * or transitions to the inline auth gate (unauthenticated).
   */
  async function handleFormSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setGlobalError(null);
    if (!validateForm()) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await submitRequest();
      } else {
        setView("auth");
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handles the create-account form submit.
   * POSTs to /api/auth/register (server-side admin client — bypasses RLS and
   * email confirmation), then signs in with the supplied password to establish
   * a session, sends a welcome email (best-effort), and submits the request.
   */
  async function handleCreateAccount(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setGlobalError(null);

    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = "First name is required.";
    if (!lastName.trim()) errors.lastName = "Last name is required.";
    if (!createEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createEmail))
      errors.createEmail = "A valid email address is required.";
    if (createPassword.length < 8)
      errors.createPassword = "Password must be at least 8 characters.";
    if (createPassword !== confirmPassword)
      errors.confirmPassword = "Passwords do not match.";
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);

    // Step 1: Create the auth user + profile server-side (admin client, no RLS)
    const registerRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        phone: phone.trim() || undefined,
      }),
    });

    const registerJson = (await registerRes.json()) as { success: boolean; error?: string };

    if (!registerRes.ok) {
      // Existing email → nudge to sign in
      if (registerRes.status === 409) {
        setGlobalError("An account with this email already exists. Try signing in instead.");
        setAuthMode("signin");
        setSigninEmail(createEmail);
      } else {
        setGlobalError(registerJson.error ?? "Failed to create account. Please try again.");
      }
      setLoading(false);
      return;
    }

    // Step 2: Sign in to establish a session so the class request API can auth us
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: createEmail.trim(),
      password: createPassword,
    });

    if (signInError) {
      setGlobalError("Account created, but sign-in failed. Please sign in manually.");
      setLoading(false);
      return;
    }

    try {
      await submitRequest();
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to submit your request."
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handles the sign-in form submit.
   * Signs in via Supabase, then immediately submits the class request.
   */
  async function handleSignIn(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setGlobalError(null);

    const errors: Record<string, string> = {};
    if (!signinEmail.trim()) errors.signinEmail = "Email is required.";
    if (!signinPassword) errors.signinPassword = "Password is required.";
    setSigninErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    const supabase = createClient();

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: signinEmail.trim(),
      password: signinPassword,
    });

    if (authError) {
      setGlobalError(
        authError.message ?? "Sign-in failed. Please check your credentials."
      );
      setLoading(false);
      return;
    }

    try {
      await submitRequest();
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Failed to submit your request."
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Success view ───────────────────────────────────────────────────────────
  if (view === "success") {
    return (
      <div className="max-w-xl mx-auto text-center py-16 px-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Request Submitted!</h2>
        <p className="text-gray-600 mb-2">
          We received your class request and will follow up within{" "}
          <strong>1–2 business days</strong>.
        </p>
        <p className="text-gray-600 mb-6">
          Check your email for a confirmation. You can track this request under{" "}
          <strong>My Class Requests</strong> in your dashboard.
        </p>
        <Link
          href="/dashboard/class-requests"
          className="inline-block bg-red-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-red-700 transition-colors"
        >
          View My Requests
        </Link>
      </div>
    );
  }

  // ── Auth gate view ─────────────────────────────────────────────────────────
  if (view === "auth") {
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">One last step</h1>
          <p className="text-gray-500 text-sm mb-6">
            Create a free account or sign in to submit your request.
          </p>

          {/* Mode toggle */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden mb-6">
            <button
              type="button"
              onClick={() => {
                setAuthMode("create");
                setGlobalError(null);
              }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors duration-150 ${
                authMode === "create"
                  ? "bg-red-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("signin");
                setGlobalError(null);
              }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors duration-150 ${
                authMode === "signin"
                  ? "bg-red-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Sign In
            </button>
          </div>

          {globalError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-5"
            >
              {globalError}
            </div>
          )}

          {/* ── Create account form ── */}
          {authMode === "create" && (
            <form onSubmit={handleCreateAccount} noValidate className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    First name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => {
                      setFirstName(e.target.value);
                      setCreateErrors((p) => ({ ...p, firstName: "" }));
                    }}
                    autoComplete="given-name"
                    className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      createErrors.firstName ? "border-red-400" : "border-gray-300"
                    }`}
                  />
                  {createErrors.firstName && (
                    <p className="text-red-500 text-xs">{createErrors.firstName}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    Last name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      setCreateErrors((p) => ({ ...p, lastName: "" }));
                    }}
                    autoComplete="family-name"
                    className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      createErrors.lastName ? "border-red-400" : "border-gray-300"
                    }`}
                  />
                  {createErrors.lastName && (
                    <p className="text-red-500 text-xs">{createErrors.lastName}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => {
                    setCreateEmail(e.target.value);
                    setCreateErrors((p) => ({ ...p, createEmail: "" }));
                  }}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    createErrors.createEmail ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {createErrors.createEmail && (
                  <p className="text-red-500 text-xs">{createErrors.createEmail}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Phone{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder="(555) 555-5555"
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => {
                    setCreatePassword(e.target.value);
                    setCreateErrors((p) => ({ ...p, createPassword: "" }));
                  }}
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters"
                  className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    createErrors.createPassword ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {passwordStrength && (
                  <p
                    aria-live="polite"
                    className={`text-xs font-medium ${STRENGTH_COLORS[passwordStrength]}`}
                  >
                    Strength:{" "}
                    {passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1)}
                  </p>
                )}
                {createErrors.createPassword && (
                  <p className="text-red-500 text-xs">{createErrors.createPassword}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Confirm password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setCreateErrors((p) => ({ ...p, confirmPassword: "" }));
                  }}
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    createErrors.confirmPassword ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {createErrors.confirmPassword && (
                  <p className="text-red-500 text-xs">{createErrors.confirmPassword}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm mt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                {loading ? "Submitting…" : "Create Account & Submit Request"}
              </button>
            </form>
          )}

          {/* ── Sign-in form ── */}
          {authMode === "signin" && (
            <form onSubmit={handleSignIn} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={signinEmail}
                  onChange={(e) => {
                    setSigninEmail(e.target.value);
                    setSigninErrors((p) => ({ ...p, signinEmail: "" }));
                  }}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    signinErrors.signinEmail ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {signinErrors.signinEmail && (
                  <p className="text-red-500 text-xs">{signinErrors.signinEmail}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <Link
                    href="/book/forgot-password"
                    className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  value={signinPassword}
                  onChange={(e) => {
                    setSigninPassword(e.target.value);
                    setSigninErrors((p) => ({ ...p, signinPassword: "" }));
                  }}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    signinErrors.signinPassword ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {signinErrors.signinPassword && (
                  <p className="text-red-500 text-xs">{signinErrors.signinPassword}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm mt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                {loading ? "Signing in…" : "Sign In & Submit Request"}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => {
              setView("form");
              setGlobalError(null);
            }}
            className="mt-6 text-sm text-gray-500 hover:text-red-600 transition-colors duration-150"
          >
            ← Edit your request
          </button>
        </div>
      </div>
    );
  }

  // ── Request form view ──────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Request a Class</h1>
        <p className="text-gray-600">
          Can&rsquo;t make it to one of our scheduled classes? We&rsquo;ll come to you.
          Fill out the form below to request a CPR class at your location. Our team
          reviews all requests and will follow up within 1–2 business days.
        </p>
      </div>

      <form
        onSubmit={handleFormSubmit}
        className="space-y-8 bg-white border border-gray-200 rounded-xl p-6 shadow-sm"
      >
        {/* ── Class details ── */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Class Details</h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="class_type_id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Class Type <span className="text-red-500">*</span>
              </label>
              <select
                id="class_type_id"
                name="class_type_id"
                value={form.class_type_id}
                onChange={handleFormChange}
                className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  formErrors.class_type_id ? "border-red-400" : "border-gray-300"
                }`}
              >
                <option value="">Select a class type…</option>
                {classTypes.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} (
                    {ct.duration_minutes % 60 === 0
                      ? `${ct.duration_minutes / 60} hr${ct.duration_minutes / 60 !== 1 ? "s" : ""}`
                      : `${Math.floor(ct.duration_minutes / 60)} hr ${ct.duration_minutes % 60} min`}
                    )
                  </option>
                ))}
              </select>
              {formErrors.class_type_id && (
                <p className="text-red-500 text-xs mt-1">{formErrors.class_type_id}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="preferred_date"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Preferred Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  id="preferred_date"
                  name="preferred_date"
                  value={form.preferred_date}
                  min={getMinDate()}
                  onChange={handleFormChange}
                  className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    formErrors.preferred_date ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {formErrors.preferred_date && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.preferred_date}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="preferred_time_of_day"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Preferred Time <span className="text-red-500">*</span>
                </label>
                <select
                  id="preferred_time_of_day"
                  name="preferred_time_of_day"
                  value={form.preferred_time_of_day}
                  onChange={handleFormChange}
                  className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    formErrors.preferred_time_of_day ? "border-red-400" : "border-gray-300"
                  }`}
                >
                  <option value="">Select a time…</option>
                  {(
                    Object.entries(PREFERRED_TIME_LABELS) as [PreferredTimeOfDay, string][]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {formErrors.preferred_time_of_day && (
                  <p className="text-red-500 text-xs mt-1">
                    {formErrors.preferred_time_of_day}
                  </p>
                )}
              </div>
            </div>

            <div className="max-w-xs">
              <label
                htmlFor="group_size"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Estimated Group Size <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                id="group_size"
                name="group_size"
                min={1}
                value={form.group_size}
                onChange={handleFormChange}
                placeholder="e.g. 12"
                className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  formErrors.group_size ? "border-red-400" : "border-gray-300"
                }`}
              />
              {formErrors.group_size && (
                <p className="text-red-500 text-xs mt-1">{formErrors.group_size}</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Venue / Location ── */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Venue / Location
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Where would you like the class held? A{" "}
            <strong>$65 travel &amp; setup fee</strong> applies to all
            customer-requested classes.
          </p>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="venue_name"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Venue / Facility Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="venue_name"
                name="venue_name"
                value={form.venue_name}
                onChange={handleFormChange}
                placeholder="e.g. Acme Corp. Office, Community Center"
                className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  formErrors.venue_name ? "border-red-400" : "border-gray-300"
                }`}
              />
              {formErrors.venue_name && (
                <p className="text-red-500 text-xs mt-1">{formErrors.venue_name}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="venue_address"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Street Address <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="venue_address"
                name="venue_address"
                value={form.venue_address}
                onChange={handleFormChange}
                placeholder="123 Main St"
                className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  formErrors.venue_address ? "border-red-400" : "border-gray-300"
                }`}
              />
              {formErrors.venue_address && (
                <p className="text-red-500 text-xs mt-1">{formErrors.venue_address}</p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label
                  htmlFor="venue_city"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  City <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="venue_city"
                  name="venue_city"
                  value={form.venue_city}
                  onChange={handleFormChange}
                  placeholder="Tampa"
                  className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    formErrors.venue_city ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {formErrors.venue_city && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.venue_city}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="venue_state"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  State <span className="text-red-500">*</span>
                </label>
                <select
                  id="venue_state"
                  name="venue_state"
                  value={form.venue_state}
                  onChange={handleFormChange}
                  className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    formErrors.venue_state ? "border-red-400" : "border-gray-300"
                  }`}
                >
                  <option value="">State</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {formErrors.venue_state && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.venue_state}</p>
                )}
              </div>

              <div>
                <label
                  htmlFor="venue_zip"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  ZIP <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="venue_zip"
                  name="venue_zip"
                  value={form.venue_zip}
                  onChange={handleFormChange}
                  placeholder="33602"
                  maxLength={10}
                  className={`block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    formErrors.venue_zip ? "border-red-400" : "border-gray-300"
                  }`}
                />
                {formErrors.venue_zip && (
                  <p className="text-red-500 text-xs mt-1">{formErrors.venue_zip}</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Additional notes ── */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Additional Notes
          </h2>
          <textarea
            id="notes"
            name="notes"
            value={form.notes}
            onChange={handleFormChange}
            rows={4}
            maxLength={500}
            placeholder="Anything else we should know? (optional)"
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-y"
          />
          <p className="text-xs text-gray-400 mt-1 text-right">
            {form.notes.length}/500
          </p>
        </section>

        {/* ── Fee callout ── */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <span className="text-amber-600 text-lg leading-none mt-0.5">ℹ️</span>
          <p className="text-sm text-amber-800">
            A <strong>$65 travel &amp; setup fee</strong> is applied to all
            customer-requested classes. This is a flat fee in addition to the
            per-student class price.
          </p>
        </div>

        {globalError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">{globalError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full sm:w-auto bg-red-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          {loading ? "Checking…" : "Submit Request"}
        </button>
      </form>
    </div>
  );
}

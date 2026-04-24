"use client";

/**
 * SettingsClient — interactive form for all account settings sections.
 * Sections: Personal Info, Email, Change Password, Danger Zone.
 * Tracks dirty state and warns with a banner on unsaved changes.
 * Handles save, email update, password change, and account deletion inline.
 * Used by: app/(public)/dashboard/settings/page.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** Profile shape passed from the server-side page.tsx. */
interface SettingsProfile {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface SettingsClientProps {
  profile: SettingsProfile;
  userId: string;
}

/** Calculates password strength for the new password field. */
function getPasswordStrength(password: string): "weak" | "good" | "strong" {
  if (password.length < 8) return "weak";
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const score = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean)
    .length;
  if (score >= 3) return "strong";
  if (score >= 2) return "good";
  return "weak";
}

const STRENGTH_LABELS = { weak: "Weak", good: "Good", strong: "Strong" };
const STRENGTH_COLORS = {
  weak: "text-red-500",
  good: "text-amber-500",
  strong: "text-green-600",
};

/** All 50 US states + DC for the state dropdown. */
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
];

/** Reusable input class to keep the form consistent. */
const inputClass =
  "border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent w-full";

/** Reusable label class. */
const labelClass = "text-sm font-medium text-gray-700";

/** Renders all account settings sections with full client-side interactivity. */
export default function SettingsClient({
  profile,
  userId,
}: SettingsClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const initialForm = {
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    phone: profile.phone ?? "",
    address: profile.address ?? "",
    city: profile.city ?? "",
    state: profile.state ?? "",
    zip: profile.zip ?? "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  };

  const [form, setForm] = useState(initialForm);
  const [savedForm, setSavedForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Inline delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isDirty =
    JSON.stringify(form) !== JSON.stringify(savedForm);

  const passwordStrength = form.newPassword
    ? getPasswordStrength(form.newPassword)
    : null;

  // Warn the user before closing/refreshing the tab with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Auto-dismiss the success message after 5 seconds
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(timer);
  }, [success]);

  /** Generic field change handler. */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = e.target;
      setForm((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  /**
   * Saves all changed fields in a single operation.
   * Steps: validate → update profile → update email → update password.
   */
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Validate password section — if any password field is filled, all three are required
      const isChangingPassword =
        form.newPassword || form.confirmPassword || form.currentPassword;
      if (isChangingPassword) {
        if (!form.currentPassword)
          throw new Error(
            "Please enter your current password to change it."
          );
        if (form.newPassword.length < 8)
          throw new Error("New password must be at least 8 characters.");
        if (form.newPassword !== form.confirmPassword)
          throw new Error("New passwords do not match.");
      }

      // Update profile fields in DB
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          first_name: form.firstName,
          last_name: form.lastName,
          phone: form.phone || null,
          address: form.address || null,
          city: form.city || null,
          state: form.state || null,
          zip: form.zip || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (profileError) throw new Error("Failed to update profile.");

      // Update email if it changed — Supabase sends a confirmation email automatically
      if (form.email !== savedForm.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: form.email,
        });
        if (emailError)
          throw new Error("Failed to update email. " + emailError.message);
      }

      // Re-authenticate then update password if fields were filled in
      if (isChangingPassword && form.newPassword && form.currentPassword) {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: savedForm.email,
            password: form.currentPassword,
          });
        if (signInError) throw new Error("Current password is incorrect.");

        const { error: passwordError } = await supabase.auth.updateUser({
          password: form.newPassword,
        });
        if (passwordError) throw new Error("Failed to update password.");
      }

      // Clear password fields and mark form as clean
      const cleaned = {
        ...form,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      };
      setForm(cleaned);
      setSavedForm(cleaned);
      setSuccess("Your settings have been saved.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Archives the account via API route, signs out, and redirects.
   * Side effects: sets profiles.archived = true, sends confirmation email.
   */
  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/account/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error ?? "Failed to delete account.");
      }

      await supabase.auth.signOut();
      router.push("/?accountDeleted=true");
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-10">
      {/* Unsaved changes banner */}
      {isDirty && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm flex items-center gap-2"
        >
          <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
          You have unsaved changes. Don&apos;t forget to save before leaving
          this page.
        </div>
      )}

      <form onSubmit={handleSave} noValidate>
        {/* ── Personal Information ── */}
        <section className="space-y-5">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Personal Information
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="firstName" className={labelClass}>
                First name <span className="text-red-500">*</span>
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                value={form.firstName}
                onChange={handleChange}
                required
                autoComplete="given-name"
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="lastName" className={labelClass}>
                Last name <span className="text-red-500">*</span>
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                value={form.lastName}
                onChange={handleChange}
                required
                autoComplete="family-name"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className={labelClass}>
              Phone
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              autoComplete="tel"
              className={inputClass}
              placeholder="(813) 555-0100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="address" className={labelClass}>
              Address
            </label>
            <p className="text-xs text-gray-400 -mt-0.5">
              Used for your certification records
            </p>
            <input
              id="address"
              name="address"
              type="text"
              value={form.address}
              onChange={handleChange}
              autoComplete="street-address"
              className={inputClass}
              placeholder="123 Main St"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="col-span-2 sm:col-span-1 flex flex-col gap-1.5">
              <label htmlFor="city" className={labelClass}>
                City
              </label>
              <input
                id="city"
                name="city"
                type="text"
                value={form.city}
                onChange={handleChange}
                autoComplete="address-level2"
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="state" className={labelClass}>
                State
              </label>
              <select
                id="state"
                name="state"
                value={form.state}
                onChange={handleChange}
                autoComplete="address-level1"
                className={inputClass}
              >
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="zip" className={labelClass}>
                ZIP
              </label>
              <input
                id="zip"
                name="zip"
                type="text"
                value={form.zip}
                onChange={handleChange}
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={10}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* ── Email Address ── */}
        <section className="space-y-4 mt-10">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Email Address
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className={labelClass}>
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
              className={inputClass}
            />
            <p className="text-xs text-gray-400 leading-relaxed">
              If you change your email address, a confirmation link will be
              sent to your new address. Your email will not update until you
              click the confirmation link.
            </p>
          </div>
        </section>

        {/* ── Change Password ── */}
        <section className="space-y-4 mt-10">
          <h2 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">
            Change Password
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="currentPassword" className={labelClass}>
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={handleChange}
              autoComplete="current-password"
              className={inputClass}
              placeholder="Required to change password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="newPassword" className={labelClass}>
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              value={form.newPassword}
              onChange={handleChange}
              autoComplete="new-password"
              minLength={8}
              className={inputClass}
              placeholder="Minimum 8 characters"
            />
            {/* Password strength indicator */}
            {passwordStrength && (
              <p
                aria-live="polite"
                className={`text-xs font-medium ${STRENGTH_COLORS[passwordStrength]}`}
              >
                Strength: {STRENGTH_LABELS[passwordStrength]}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirmPassword" className={labelClass}>
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange}
              autoComplete="new-password"
              className={inputClass}
              placeholder="Re-enter new password"
            />
          </div>
        </section>

        {/* ── Status messages ── */}
        <div className="mt-8 space-y-3">
          {error && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2"
            >
              <XCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              {error}
            </div>
          )}
          {success && (
            <div
              role="alert"
              className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm flex items-center gap-2"
            >
              <CheckCircle size={15} className="shrink-0" aria-hidden="true" />
              {success}
            </div>
          )}
        </div>

        {/* ── Save button ── */}
        <div className="mt-6">
          <button
            type="submit"
            disabled={!isDirty || saving}
            className="w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors duration-150"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>

      {/* ── Danger Zone ── */}
      <section className="border border-red-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 bg-red-50 border-b border-red-200">
          <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
        </div>
        <div className="px-5 py-5">
          {!showDeleteConfirm ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-semibold text-sm text-gray-900">
                  Delete Account
                </p>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-prose">
                  Deleting your account will permanently remove your access to
                  Superhero CPR. Your certification history will be preserved
                  for our records but you will no longer be able to log in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="shrink-0 border border-red-400 text-red-600 hover:bg-red-50 font-medium text-sm px-4 py-2 rounded-lg transition-colors duration-150"
              >
                Delete My Account
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-gray-800">
                Are you sure? This cannot be undone.
              </p>
              {deleteError && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm"
                >
                  {deleteError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                  className="border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium text-sm px-4 py-2 rounded-lg transition-colors duration-150 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors duration-150 disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Yes, delete my account"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

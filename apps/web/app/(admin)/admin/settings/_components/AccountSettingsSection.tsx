"use client";

/**
 * AccountSettingsSection component
 * Lets a staff member edit their own name, phone, login email, and password.
 * Saves via PATCH /api/profile/self-update.
 * Used by: InstructorSettingsClient (Account tab)
 *
 * The email field is both the contact address and the login address: the site
 * treats them as one value, which is why there is a single Email input here.
 * Changing email or password requires the current password; a "Forgot your
 * password?" link routes to the existing reset-by-email flow for anyone who
 * cannot supply it.
 *
 * TODO: no outcome e2e test drives this form. Invariant #14
 * (profile_auth_email_mismatch, migration 0065) proves profiles.email and
 * auth.users.email stay in step, but nothing asserts a save actually applies
 * what the user typed: a field that silently stopped submitting would pass
 * every current signal. Deferred as a known gap; see Building/feature-health-map.md
 * under "Staff self-service account".
 */

import React, { useState } from "react";

export interface AccountSettingsSectionProps {
  /** Current saved first name from the DB. */
  initialFirstName: string;
  /** Current saved last name from the DB. */
  initialLastName: string;
  /** Current saved phone from the DB. Empty string when never set. */
  initialPhone: string;
  /** Current saved email from the DB: also the login address. */
  initialEmail: string;
  /** True when this is an owner account, whose email is pinned by configuration. */
  isOwner: boolean;
  /** Called with a success message after a save completes. */
  onSuccess: (message: string) => void;
  /** Called with an error message on failure. */
  onError: (message: string) => void;
}

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent disabled:bg-gray-50 disabled:text-gray-500";

const labelClass = "block text-sm font-medium text-gray-700 mb-1";

/**
 * Self-service account form for the staff settings page.
 * @param initialFirstName - Saved first name.
 * @param initialLastName - Saved last name.
 * @param initialPhone - Saved phone number.
 * @param initialEmail - Saved email / login address.
 * @param isOwner - Whether the email field must be locked (owner account).
 * @param onSuccess - Called with a success message after saving.
 * @param onError - Called with an error message on failure.
 */
const AccountSettingsSection: React.FC<AccountSettingsSectionProps> = ({
  initialFirstName,
  initialLastName,
  initialPhone,
  initialEmail,
  isOwner,
  onSuccess,
  onError,
}) => {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  /** The last values written to the DB: used to detect what actually changed. */
  const [saved, setSaved] = useState({
    firstName: initialFirstName,
    lastName: initialLastName,
    phone: initialPhone,
    email: initialEmail,
  });

  const emailChanged = email.trim().toLowerCase() !== saved.email.toLowerCase();
  const changingPassword = newPassword.length > 0 || confirmPassword.length > 0;
  const needsPassword = emailChanged || changingPassword;

  /**
   * Validates the form, then saves via PATCH /api/profile/self-update.
   * Clears the password fields on success so they are never left populated.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();

    if (!firstName.trim() || !lastName.trim()) {
      onError("First and last name are required.");
      return;
    }

    if (!phone.trim()) {
      onError("Phone number is required.");
      return;
    }

    if (!email.trim()) {
      onError("Email address is required.");
      return;
    }

    if (changingPassword) {
      if (newPassword.length < 8) {
        onError("New password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        onError("New passwords do not match.");
        return;
      }
    }

    if (needsPassword && !currentPassword) {
      onError("Enter your current password to change your email or password.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/profile/self-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          email: email.trim().toLowerCase(),
          ...(needsPassword ? { current_password: currentPassword } : {}),
          ...(changingPassword ? { new_password: newPassword } : {}),
        }),
      });

      const data: { success: boolean; error?: string } = await res.json();

      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to save your account details.");
        return;
      }

      setSaved({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess("Your account details have been saved.");
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── Contact details ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Your details</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            This name, phone number, and email are what students see on the booking
            page and in their confirmation emails.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="acct-first" className={labelClass}>
              First name <span className="text-red-500">*</span>
            </label>
            <input
              id="acct-first"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acct-last" className={labelClass}>
              Last name <span className="text-red-500">*</span>
            </label>
            <input
              id="acct-last"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="acct-phone" className={labelClass}>
            Phone number <span className="text-red-500">*</span>
          </label>
          <input
            id="acct-phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="(813) 555-0100"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="acct-email" className={labelClass}>
            Email address <span className="text-red-500">*</span>
          </label>
          <input
            id="acct-email"
            type="email"
            required
            disabled={isOwner}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className={inputClass}
          />
          <p className="text-xs text-gray-500 mt-1">
            {isOwner
              ? "The owner account's email is tied to system configuration and can't be changed here."
              : "This is also the address you sign in with. Changing it requires your current password."}
          </p>
        </div>
      </section>

      {/* ── Password ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 border-t border-gray-200 pt-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Change password</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Leave these blank to keep your current password.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="acct-new-password" className={labelClass}>
              New password
            </label>
            <input
              id="acct-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="8+ characters"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acct-confirm-password" className={labelClass}>
              Confirm new password
            </label>
            <input
              id="acct-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* ── Verification ─────────────────────────────────────────────────── */}
      {/* Shown only once a change actually needs it, so a plain name or phone
          edit never asks for a password. */}
      {needsPassword && (
        <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <label htmlFor="acct-current-password" className={labelClass}>
            Current password <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-600 -mt-1 mb-2">
            Required to change your email address or password.
          </p>
          <input
            id="acct-current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
          <p className="text-xs text-gray-600 pt-1">
            Don&apos;t remember it?{" "}
            <a
              href="/book/forgot-password"
              className="font-medium text-red-600 hover:text-red-700 underline"
            >
              Email yourself a reset link
            </a>
            .
          </p>
        </section>
      )}

      <div className="flex items-center gap-3 border-t border-gray-200 pt-6">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {!needsPassword && (
          <a
            href="/book/forgot-password"
            className="text-sm font-medium text-gray-500 hover:text-red-600 transition-colors"
          >
            Forgot your password?
          </a>
        )}
      </div>
    </form>
  );
};

export default AccountSettingsSection;

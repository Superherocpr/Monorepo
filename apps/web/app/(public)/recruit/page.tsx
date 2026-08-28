"use client";

/**
 * Recruit page — /recruit
 * Public page (no auth required). Used by students registering for a class
 * on class day when their employer or school paid a bulk rate and the exact
 * student list was not known in advance.
 *
 * Flow:
 *   Step 1 → Enter 6-digit instructor access code
 *   Step 2 → Select session (only shown when instructor has multiple today)
 *   Step 3 → Fill in name, phone, email, and password to create an account
 *   Step 4 → Confirmation
 *
 * Used by: (public) layout
 */

import { useState, useRef } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatClassTime } from "@/lib/business-time";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecruitSession {
  id: string;
  startsAt: string;
  classTypeName: string;
  locationName: string;
}

interface VerifyCodeResult {
  valid: boolean;
  instructorName: string;
  sessions: RecruitSession[];
}

type Step = 1 | 2 | 3 | 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Sub-components ────────────────────────────────────────────────────────────

/** Shared container for all steps. */
function StepContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 pt-12 pb-8">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

/** Large primary action button. */
function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-lg font-semibold py-4 rounded-xl transition-colors"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Creating account…
        </span>
      ) : (
        children
      )}
    </button>
  );
}

/** Inline error message. */
function ErrorMsg({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-red-600 text-center mt-2">
      {message}
    </p>
  );
}

/** Labelled text input used in the registration form. */
function FormField({
  id,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Multi-step self-registration flow for bulk-enrolled students.
 * Students enter the instructor's code, select their session, fill in their
 * information, and create an account — all in one flow on class day.
 *
 * Steps:
 * 1 → Enter 6-digit access code
 * 2 → Select session (if instructor has more than one today)
 * 3 → Enter name, phone, email, and password
 * 4 → Confirmation
 */
export default function RecruitPage() {
  // ── Shared state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  // ── Step 2 state ──────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<RecruitSession[]>([]);
  const [instructorName, setInstructorName] = useState("");
  const [selectedSession, setSelectedSession] = useState<RecruitSession | null>(null);

  // ── Step 3 state ──────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // ── Step 4 state ─────────────────────────────────────────────────────────
  const [confirmedFirstName, setConfirmedFirstName] = useState("");

  // ── Step 1: Verify the access code ────────────────────────────────────────

  /**
   * Fires on each keystroke; auto-submits once 6 digits are entered.
   * Reuses the same verify-code endpoint as /rollcall.
   * @param value - Current text input value
   */
  async function handleCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError(null);

    if (digits.length !== 6) return;

    setLoading(true);
    try {
      const res = await fetch("/api/rollcall/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: digits }),
      });
      const result = (await res.json()) as VerifyCodeResult;

      if (!result.valid || !result.sessions?.length) {
        setError("Code not found. Please check with your instructor.");
        setCode("");
        codeRef.current?.focus();
        return;
      }

      setInstructorName(result.instructorName ?? "");
      setSessions(result.sessions);

      if (result.sessions.length === 1) {
        // Only one session — skip the picker
        setSelectedSession(result.sessions[0]);
        setStep(3);
      } else {
        setStep(2);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Session selection ──────────────────────────────────────────────

  /**
   * Called when the student taps a session from the list.
   * @param session - The session they selected
   */
  function handleSessionSelect(session: RecruitSession) {
    setSelectedSession(session);
    setError(null);
    setStep(3);
  }

  // ── Step 3: Registration form submission ───────────────────────────────────

  /**
   * Validates the form, calls /api/rollcall/recruit, and advances on success.
   * Creates a Supabase Auth account, profile, booking, and roster record.
   */
  async function handleRegister() {
    if (!selectedSession) return;

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }

    if (!phone.trim()) {
      setError("Phone number is required.");
      return;
    }

    if (!email.trim() || !emailPattern.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!password) {
      setError("Please choose a password.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rollcall/recruit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSession.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          password,
        }),
      });

      const result = (await res.json()) as { success?: boolean; error?: string; firstName?: string };

      if (!result.success) {
        setError(result.error ?? "Registration failed. Please try again.");
        return;
      }

      setConfirmedFirstName(result.firstName ?? firstName.trim());
      setStep(4);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // ── Step 1: Enter code ────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <StepContainer>
        <h1 className="text-3xl font-bold text-gray-900 text-center mb-2">
          Register for Class
        </h1>
        <p className="text-gray-500 text-center mb-8">
          Enter the code your instructor gave you to get started.
        </p>

        <div className="relative">
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="------"
            disabled={loading}
            autoFocus
            className="w-full text-center text-4xl font-bold tracking-[0.4em] border-2 border-gray-300 rounded-xl py-5 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50"
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
            </div>
          )}
        </div>

        {error && <ErrorMsg message={error} />}
      </StepContainer>
    );
  }

  // ── Step 2: Session selector ──────────────────────────────────────────────
  if (step === 2) {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          Which class are you in?
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          {instructorName} has multiple classes today.
        </p>

        <div className="space-y-2">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSessionSelect(s)}
              className="w-full text-left px-4 py-4 bg-white border border-gray-200 rounded-xl hover:border-red-400 hover:bg-red-50 transition-colors"
            >
              <p className="font-semibold text-gray-900">{s.classTypeName}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {formatClassTime(s.startsAt)} · {s.locationName}
              </p>
            </button>
          ))}
        </div>

        {error && <ErrorMsg message={error} />}
      </StepContainer>
    );
  }

  // ── Step 3: Registration form ─────────────────────────────────────────────
  if (step === 3) {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          Create your account
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          Fill in your information below. You&apos;ll use this account to
          access your certificate after class.
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              id="firstName"
              label="First name"
              value={firstName}
              onChange={setFirstName}
              autoComplete="given-name"
              required
            />
            <FormField
              id="lastName"
              label="Last name"
              value={lastName}
              onChange={setLastName}
              autoComplete="family-name"
              required
            />
          </div>

          <FormField
            id="phone"
            label="Phone number"
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="(555) 555-5555"
            autoComplete="tel"
            required
          />

          <FormField
            id="email"
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />

          <FormField
            id="password"
            label="Choose a password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="8+ characters"
            autoComplete="new-password"
            required
          />
        </div>

        {error && <ErrorMsg message={error} />}

        <div className="mt-6">
          <PrimaryButton onClick={handleRegister} loading={loading}>
            Register &amp; Check In
          </PrimaryButton>
        </div>
      </StepContainer>
    );
  }

  // ── Step 4: Confirmation ──────────────────────────────────────────────────
  return (
    <StepContainer>
      <div className="text-center space-y-4">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
        <h1 className="text-2xl font-bold text-gray-900">
          You&apos;re checked in, {confirmedFirstName}!
        </h1>
        <p className="text-gray-500">
          Your account has been created and you&apos;re registered for today&apos;s
          class. Your instructor has you on the roster.
        </p>
        <p className="text-sm text-gray-400">
          After class you can sign in at superherocpr.com to access your
          certification.
        </p>
      </div>
    </StepContainer>
  );
}

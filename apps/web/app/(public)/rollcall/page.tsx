"use client";

/**
 * Rollcall page — /rollcall
 * Public page (no auth required). Used by students on class day to check in.
 * Students enter the instructor's 6-digit daily code, identify themselves,
 * and are added to the class roster. No booking records are created here —
 * students already have bookings from paying online or via invoice.
 *
 * Used by: (public) layout
 */

import { useState, useEffect, useRef } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RollcallSession {
  id: string;
  startsAt: string;
  classTypeName: string;
  locationName: string;
}

interface VerifyCodeResult {
  valid: boolean;
  instructorId: string;
  instructorName: string;
  sessions: RollcallSession[];
}

interface CheckEmailResult {
  exists: boolean;
  firstName?: string;
  hasBooking: boolean;
}

type Step = 1 | 2 | 3 | "4a" | "4b" | 5;

// ── Password strength ─────────────────────────────────────────────────────────

/**
 * Returns a 0–4 strength score for a password.
 * @param pw - password string to evaluate
 */
function passwordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_LABELS = ["Weak", "Fair", "Good", "Strong", "Very Strong"];
const STRENGTH_COLORS = [
  "bg-red-500",
  "bg-orange-400",
  "bg-amber-400",
  "bg-green-500",
  "bg-green-600",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats an ISO datetime to a short time string, e.g. "9:00 AM".
 * @param iso - ISO date string
 */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Shared container for all steps — max-w-sm centered, generous padding. */
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
          Please wait…
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

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Multi-step rollcall flow. Steps:
 * 1 → Enter 6-digit access code
 * 2 → Select session (if instructor has more than one today)
 * 3 → Enter email
 * 4a → Returning student sign-in
 * 4b → New student account creation
 * 5 → Confirmation
 */
export default function RollcallPage() {
  // ── Shared state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1 state ──────────────────────────────────────────────────────────
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  // ── Step 2 / session selection state ─────────────────────────────────────
  const [sessions, setSessions] = useState<RollcallSession[]>([]);
  const [instructorName, setInstructorName] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [selectedSession, setSelectedSession] = useState<RollcallSession | null>(null);

  // ── Step 3 state ──────────────────────────────────────────────────────────
  const [email, setEmail] = useState("");

  // ── Step 4a state ─────────────────────────────────────────────────────────
  const [returningFirstName, setReturningFirstName] = useState("");
  const [password, setPassword] = useState("");

  // ── Step 4b state ─────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // ── Step 5 state ─────────────────────────────────────────────────────────
  const [isNewUser, setIsNewUser] = useState(false);
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [checkedInFirstName, setCheckedInFirstName] = useState("");

  // Auto-focus code input on mount
  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  // ── Step 1: Verify access code ────────────────────────────────────────────

  /**
   * Fires when the code input reaches 6 digits.
   * POSTs to /api/rollcall/verify-code to look up the instructor.
   * Advances to step 2 (select session) or 3 (if only one session today).
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

      if (!result.valid || result.sessions.length === 0) {
        setError("That code doesn't match. Check with your instructor.");
        setCode("");
        codeRef.current?.focus();
        return;
      }

      setInstructorId(result.instructorId);
      setInstructorName(result.instructorName);
      setSessions(result.sessions);

      if (result.sessions.length === 1) {
        // Skip session selection — go straight to email
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

  // ── Step 2: Select session ────────────────────────────────────────────────

  /**
   * Records the chosen session and advances to the email step.
   * @param session - the session the student tapped
   */
  function handleSessionSelect(session: RollcallSession) {
    setSelectedSession(session);
    setStep(3);
  }

  // ── Step 3: Check email ───────────────────────────────────────────────────

  /**
   * POSTs to /api/rollcall/check-email to determine if the student
   * has an existing account. Routes to step 4a or 4b accordingly.
   */
  async function handleEmailSubmit() {
    if (!email || !selectedSession) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rollcall/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), sessionId: selectedSession.id }),
      });

      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }

      const result = (await res.json()) as CheckEmailResult;

      if (result.exists) {
        setReturningFirstName(result.firstName ?? "");
        setStep("4a");
      } else {
        setStep("4b");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 4a: Sign in (returning student) ──────────────────────────────────

  /**
   * Signs the returning student in and creates their roster_record.
   * If they're already checked in, confirms gracefully without an error.
   */
  async function handleSignIn() {
    if (!email || !password || !selectedSession) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rollcall/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          sessionId: selectedSession.id,
        }),
      });

      const result = (await res.json()) as {
        success: boolean;
        error?: string;
        alreadyCheckedIn?: boolean;
        firstName?: string;
      };

      if (!result.success) {
        setError(result.error ?? "Incorrect password.");
        return;
      }

      setIsNewUser(false);
      setAlreadyCheckedIn(!!result.alreadyCheckedIn);
      setCheckedInFirstName(result.firstName ?? returningFirstName);
      setStep(5);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 4b: Create account (new student) ────────────────────────────────

  /**
   * Creates a new Superhero CPR account, adds the student to the roster,
   * and sends a welcome email.
   */
  async function handleRegister() {
    if (!firstName || !lastName || !newPassword || !selectedSession) return;

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/rollcall/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          password: newPassword,
          sessionId: selectedSession.id,
        }),
      });

      const result = (await res.json()) as { success: boolean; error?: string };

      if (!result.success) {
        setError(result.error ?? "Failed to create account. Please try again.");
        return;
      }

      setIsNewUser(true);
      setAlreadyCheckedIn(false);
      setCheckedInFirstName(firstName.trim());
      setStep(5);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <StepContainer>
        <h1 className="text-3xl font-bold text-gray-900 text-center mb-2">Welcome to class!</h1>
        <p className="text-gray-500 text-center mb-8">Enter the code your instructor gave you.</p>

        <div className="relative">
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="------"
            className="w-full text-center text-5xl font-bold tracking-widest border-2 border-gray-200 rounded-2xl py-6 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
            aria-label="6-digit access code"
            autoComplete="off"
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/80">
              <Loader2 className="w-8 h-8 animate-spin text-red-600" />
            </div>
          )}
        </div>

        {error && <ErrorMsg message={error} />}
      </StepContainer>
    );
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  if (step === 2) {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Which class are you attending?
        </h1>
        <p className="text-gray-500 text-center mb-6 text-sm">
          {instructorName} has multiple classes today.
        </p>

        <div className="space-y-3">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSessionSelect(s)}
              className="w-full text-left bg-white border-2 border-gray-200 hover:border-red-500 rounded-xl p-5 transition-colors"
            >
              <p className="font-semibold text-gray-900 text-lg">{s.classTypeName}</p>
              <p className="text-gray-500 text-sm mt-0.5">
                {formatTime(s.startsAt)} · {s.locationName}
              </p>
            </button>
          ))}
        </div>
      </StepContainer>
    );
  }

  // ── Step 3 ────────────────────────────────────────────────────────────────
  if (step === 3) {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          What&apos;s your email address?
        </h1>
        {selectedSession && (
          <p className="text-gray-500 text-center text-sm mb-6">
            {selectedSession.classTypeName} at {formatTime(selectedSession.startsAt)}
          </p>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEmailSubmit()}
              placeholder="your@email.com"
              className="w-full text-lg border-2 border-gray-200 rounded-xl px-4 py-4 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="email"
              autoFocus
            />
          </div>

          {error && <ErrorMsg message={error} />}

          <PrimaryButton onClick={handleEmailSubmit} loading={loading} disabled={!email}>
            Continue
          </PrimaryButton>
        </div>
      </StepContainer>
    );
  }

  // ── Step 4a — Returning student ───────────────────────────────────────────
  if (step === "4a") {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Welcome back{returningFirstName ? `, ${returningFirstName}` : ""}!
        </h1>
        <p className="text-gray-500 text-center text-sm mb-6">
          Enter your password to check in.
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
              placeholder="Password"
              className="w-full text-lg border-2 border-gray-200 rounded-xl px-4 py-4 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="current-password"
              autoFocus
            />
          </div>

          {error && <ErrorMsg message={error} />}

          <PrimaryButton onClick={handleSignIn} loading={loading} disabled={!password}>
            Check In
          </PrimaryButton>

          <p className="text-center text-sm text-gray-400">
            <a href="/book/forgot-password" className="underline hover:text-gray-600">
              Forgot password?
            </a>
          </p>
        </div>
      </StepContainer>
    );
  }

  // ── Step 4b — New student ─────────────────────────────────────────────────
  if (step === "4b") {
    const strength = passwordStrength(newPassword);

    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">
          Let&apos;s get you set up
        </h1>
        <p className="text-gray-500 text-center text-sm mb-6">
          Create your account to check in and access your certifications later.
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="first-name" className="sr-only">
                First name
              </label>
              <input
                id="first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
                autoComplete="given-name"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="last-name" className="sr-only">
                Last name
              </label>
              <input
                id="last-name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
                autoComplete="family-name"
              />
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="sr-only">
              Phone number (optional)
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="tel"
            />
          </div>

          <div>
            <label htmlFor="new-password" className="sr-only">
              Password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password (min 8 characters)"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="new-password"
            />
            {/* Password strength indicator */}
            {newPassword.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex gap-0.5 flex-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full ${
                        i < strength ? STRENGTH_COLORS[strength] : "bg-gray-200"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-gray-500 w-20 text-right">
                  {STRENGTH_LABELS[strength]}
                </span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="confirm-password" className="sr-only">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="new-password"
            />
          </div>

          {error && <ErrorMsg message={error} />}

          <PrimaryButton
            onClick={handleRegister}
            loading={loading}
            disabled={!firstName || !lastName || !newPassword || !confirmPassword}
          >
            Create Account &amp; Check In
          </PrimaryButton>
        </div>
      </StepContainer>
    );
  }

  // ── Step 5 — Confirmation ─────────────────────────────────────────────────
  return (
    <StepContainer>
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-6">
          <CheckCircle2 className="w-10 h-10 text-green-600" aria-hidden="true" />
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">You&apos;re checked in!</h1>

        {selectedSession && (
          <p className="text-gray-500 text-base mb-4">
            {selectedSession.classTypeName} at {formatTime(selectedSession.startsAt)}&nbsp;—{" "}
            {selectedSession.locationName}
          </p>
        )}

        {alreadyCheckedIn ? (
          <p className="text-gray-400 text-sm">You&apos;re already checked in for this class!</p>
        ) : isNewUser ? (
          <p className="text-gray-500 text-sm">
            Welcome to Superhero CPR! A welcome email is on its way.
          </p>
        ) : (
          <p className="text-gray-500 text-sm">
            Good to see you again{checkedInFirstName ? `, ${checkedInFirstName}` : ""}!
          </p>
        )}
      </div>
    </StepContainer>
  );
}

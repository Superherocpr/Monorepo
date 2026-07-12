"use client";

/**
 * Rollcall page — /rollcall
 * Public page (no auth required). Used by students on class day to confirm
 * their contact information and check in for class.
 *
 * Flow:
 *   Step 1      → Enter 6-digit instructor access code
 *   Step 2      → Select session (only shown when instructor has multiple today)
 *   Step 3      → Pick your name from the enrolled student roster
 *   Step 4      → Review your contact info (read-only) — check in, or update it
 *   Step 4-edit → Enter password + update your info, then check in
 *   Step 5      → Confirmation
 *
 * Used by: (public) layout
 */

import { useState, useEffect, useRef } from "react";
import { CheckCircle2, Loader2, ChevronRight, Pencil } from "lucide-react";

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

/** Minimal student data returned by the roster listing — no sensitive fields. */
interface StudentSummary {
  profileId: string;
  bookingId: string;
  firstName: string;
  lastName: string;
}

/** Full contact details shown on the review screen. */
interface StudentProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

type Step = 1 | 2 | 3 | 4 | "4-edit" | 5;

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

/** Secondary (outline) button — used for the "Update My Info" action. */
function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full border-2 border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 text-lg font-semibold py-4 rounded-xl transition-colors bg-white"
    >
      {children}
    </button>
  );
}

/** Read-only info row — label above value, with a bottom divider. */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
        {label}
      </p>
      <p className="text-gray-900 font-medium">{value || "—"}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Multi-step rollcall check-in flow.
 * Students enter the instructor's code, find their name on the roster, confirm
 * their contact info (or update it with their password), then check in.
 *
 * Steps:
 * 1      → Enter 6-digit access code
 * 2      → Select session (if instructor has more than one today)
 * 3      → Pick your name from the enrolled student roster
 * 4      → Review your contact info — check in directly, or update it
 * 4-edit → Update your info (requires password), then check in
 * 5      → Confirmation
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
  const [, setInstructorId] = useState("");
  const [selectedSession, setSelectedSession] = useState<RollcallSession | null>(null);

  // ── Step 3 state ─────────────────────────────────────────────────────────
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // ── Step 4 / 4-edit state ─────────────────────────────────────────────────
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);

  // Edit fields — pre-populated from studentProfile when the student taps "Update My Info"
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editZip, setEditZip] = useState("");
  const [editPassword, setEditPassword] = useState("");

  // ── Step 5 state ─────────────────────────────────────────────────────────
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);
  const [checkedInFirstName, setCheckedInFirstName] = useState("");

  // Auto-focus code input on mount
  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  // ── Step 1: Verify access code ────────────────────────────────────────────

  /**
   * Fires when the code input reaches 6 digits. Verifies the code with the
   * server, then loads the student roster for the resolved session.
   * Advances to step 2 (select session) or step 3 (roster picker).
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
        // Only one session today — load the roster and skip session selection
        const session = result.sessions[0];
        setSelectedSession(session);
        await loadStudents(session);
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
   * Records the chosen session, loads its roster, and advances to step 3.
   * @param session - the session the student tapped
   */
  async function handleSessionSelect(session: RollcallSession) {
    setSelectedSession(session);
    await loadStudents(session);
    setStep(3);
  }

  /**
   * Fetches the enrolled student list for a given session and stores it in
   * state so step 3 can render the roster picker.
   * @param session - the session to load students for
   */
  async function loadStudents(session: RollcallSession) {
    setStudentsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/session-students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!res.ok) {
        setError("Could not load the class roster. Please try again.");
        return;
      }
      const result = (await res.json()) as { students: StudentSummary[] };
      setStudents(result.students);
    } catch {
      setError("Something went wrong loading the class roster.");
    } finally {
      setStudentsLoading(false);
    }
  }

  // ── Step 3: Pick your name ────────────────────────────────────────────────

  /**
   * Fetches the full contact profile for the tapped student and advances to
   * the info-review step.
   * @param student - the student the user tapped from the roster list
   */
  async function handleStudentSelect(student: StudentSummary) {
    setSelectedStudent(student);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/student-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: student.profileId,
          sessionId: selectedSession!.id,
        }),
      });
      if (!res.ok) {
        setError("Could not load your information. Please try again.");
        return;
      }
      const profile = (await res.json()) as StudentProfile;
      setStudentProfile(profile);
      setStep(4);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 4: Direct check-in (no edits needed) ─────────────────────────────

  /**
   * Checks in the selected student without changing any profile data.
   * The 6-digit code and a verified booking are the security gate here —
   * no password is required for a plain confirmation.
   */
  async function handleDirectCheckin() {
    if (!selectedStudent || !selectedSession) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/checkin-by-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedStudent.profileId,
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
        setError(result.error ?? "Check-in failed. Please try again.");
        return;
      }
      setAlreadyCheckedIn(!!result.alreadyCheckedIn);
      setCheckedInFirstName(result.firstName ?? selectedStudent.firstName);
      setStep(5);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pre-populates the edit fields from the loaded profile and advances to the
   * password-gated edit step.
   */
  function handleStartEdit() {
    if (!studentProfile) return;
    setEditFirstName(studentProfile.firstName);
    setEditLastName(studentProfile.lastName);
    setEditEmail(studentProfile.email);
    setEditPhone(studentProfile.phone ?? "");
    setEditAddress(studentProfile.address ?? "");
    setEditCity(studentProfile.city ?? "");
    setEditState(studentProfile.state ?? "");
    setEditZip(studentProfile.zip ?? "");
    setEditPassword("");
    setError(null);
    setStep("4-edit");
  }

  // ── Step 4-edit: Save changes + check in ─────────────────────────────────

  /**
   * Verifies the student's password, saves their updated profile, and checks
   * them in. All fields are re-validated server-side before any write occurs.
   */
  async function handleEditAndCheckin() {
    if (!selectedStudent || !selectedSession) return;

    if (!editFirstName.trim() || !editLastName.trim() || !editEmail.trim()) {
      setError("First name, last name, and email are required.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(editEmail.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!editPassword) {
      setError("Please enter your password to save changes.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/checkin-by-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedStudent.profileId,
          sessionId: selectedSession.id,
          password: editPassword,
          updates: {
            firstName: editFirstName.trim(),
            lastName: editLastName.trim(),
            email: editEmail.trim().toLowerCase(),
            phone: editPhone.trim() || null,
            address: editAddress.trim() || null,
            city: editCity.trim() || null,
            state: editState.trim() || null,
            zip: editZip.trim() || null,
          },
        }),
      });
      const result = (await res.json()) as {
        success: boolean;
        error?: string;
        alreadyCheckedIn?: boolean;
        firstName?: string;
      };
      if (!result.success) {
        setError(result.error ?? "Failed to update. Please check your password and try again.");
        return;
      }
      setAlreadyCheckedIn(!!result.alreadyCheckedIn);
      setCheckedInFirstName(result.firstName ?? editFirstName.trim());
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

        {error && <ErrorMsg message={error} />}
      </StepContainer>
    );
  }

  // ── Step 3 — Roster picker ────────────────────────────────────────────────
  if (step === 3) {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Who are you?</h1>
        {selectedSession && (
          <p className="text-gray-500 text-center text-sm mb-6">
            {selectedSession.classTypeName} · {formatTime(selectedSession.startsAt)}
          </p>
        )}

        {studentsLoading || loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-red-600" />
          </div>
        ) : (
          <div className="space-y-2">
            {students.map((student) => (
              <button
                key={student.profileId}
                type="button"
                onClick={() => handleStudentSelect(student)}
                className="w-full text-left bg-white border-2 border-gray-200 hover:border-red-500 rounded-xl px-5 py-4 transition-colors flex items-center justify-between"
              >
                <span className="font-medium text-gray-900">
                  {student.firstName} {student.lastName}
                </span>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </button>
            ))}

            {students.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-8">
                No students found for this class.
              </p>
            )}

            {/* Fallback for students whose name doesn't appear on the roster */}
            <p className="text-center text-xs text-gray-400 pt-4">
              Don&apos;t see your name?{" "}
              <a href="mailto:info@superherocpr.com" className="underline hover:text-gray-600">
                Contact us
              </a>
            </p>
          </div>
        )}

        {error && <ErrorMsg message={error} />}
      </StepContainer>
    );
  }

  // ── Step 4 — Info review ──────────────────────────────────────────────────
  if (step === 4 && studentProfile) {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Is this your information?
        </h1>
        <p className="text-gray-500 text-center text-sm mb-6">
          Your instructor uses this to issue your certification.
        </p>

        {/* Read-only display of the student's current profile data */}
        <div className="bg-white border-2 border-gray-100 rounded-2xl px-5 mb-6">
          <InfoRow label="First Name" value={studentProfile.firstName} />
          <InfoRow label="Last Name" value={studentProfile.lastName} />
          <InfoRow label="Email" value={studentProfile.email} />
          <InfoRow label="Phone" value={studentProfile.phone ?? "—"} />
          <InfoRow
            label="Address"
            value={
              studentProfile.address
                ? [
                    studentProfile.address,
                    studentProfile.city,
                    studentProfile.state,
                    studentProfile.zip,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : "—"
            }
          />
        </div>

        {error && <ErrorMsg message={error} />}

        <div className="space-y-3">
          <PrimaryButton onClick={handleDirectCheckin} loading={loading}>
            This is correct — Check Me In
          </PrimaryButton>

          <SecondaryButton onClick={handleStartEdit} disabled={loading}>
            <span className="flex items-center justify-center gap-2">
              <Pencil className="w-4 h-4" />
              Update My Info
            </span>
          </SecondaryButton>
        </div>
      </StepContainer>
    );
  }

  // ── Step 4-edit — Update info + check in ─────────────────────────────────
  if (step === "4-edit") {
    return (
      <StepContainer>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Update your information
        </h1>
        <p className="text-gray-500 text-center text-sm mb-6">
          Make your changes below, then enter your password to save and check in.
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-first-name" className="sr-only">
                First name
              </label>
              <input
                id="edit-first-name"
                type="text"
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
                placeholder="First name"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
                autoComplete="given-name"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="edit-last-name" className="sr-only">
                Last name
              </label>
              <input
                id="edit-last-name"
                type="text"
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
                placeholder="Last name"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
                autoComplete="family-name"
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-email" className="sr-only">
              Email address
            </label>
            <input
              id="edit-email"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              placeholder="Email address"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="edit-phone" className="sr-only">
              Phone number (optional)
            </label>
            <input
              id="edit-phone"
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="tel"
            />
          </div>

          <div>
            <label htmlFor="edit-address" className="sr-only">
              Street address (optional)
            </label>
            <input
              id="edit-address"
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              placeholder="Street address (optional)"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="street-address"
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label htmlFor="edit-city" className="sr-only">City</label>
              <input
                id="edit-city"
                type="text"
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
                placeholder="City"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
                autoComplete="address-level2"
              />
            </div>
            <div>
              <label htmlFor="edit-state" className="sr-only">State</label>
              <input
                id="edit-state"
                type="text"
                value={editState}
                onChange={(e) => setEditState(e.target.value)}
                placeholder="ST"
                maxLength={2}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white uppercase"
                autoComplete="address-level1"
              />
            </div>
            <div>
              <label htmlFor="edit-zip" className="sr-only">ZIP code</label>
              <input
                id="edit-zip"
                type="text"
                value={editZip}
                onChange={(e) => setEditZip(e.target.value)}
                placeholder="ZIP"
                maxLength={10}
                inputMode="numeric"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
                autoComplete="postal-code"
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-password" className="sr-only">
              Password
            </label>
            <input
              id="edit-password"
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEditAndCheckin()}
              placeholder="Your password"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 focus:outline-none focus:border-red-500 text-gray-900 bg-white"
              autoComplete="current-password"
            />
          </div>

          {error && <ErrorMsg message={error} />}

          <PrimaryButton
            onClick={handleEditAndCheckin}
            loading={loading}
            disabled={!editFirstName || !editLastName || !editEmail || !editPassword}
          >
            Save &amp; Check Me In
          </PrimaryButton>

          {/* Allow the student to go back without saving */}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep(4);
            }}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-2"
          >
            Cancel
          </button>

          <p className="text-center text-sm text-gray-400">
            <a href="/book/forgot-password" className="underline hover:text-gray-600">
              Forgot password?
            </a>
          </p>
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
        ) : (
          <p className="text-gray-500 text-sm">
            Good to see you{checkedInFirstName ? `, ${checkedInFirstName}` : ""}!
          </p>
        )}
      </div>
    </StepContainer>
  );
}

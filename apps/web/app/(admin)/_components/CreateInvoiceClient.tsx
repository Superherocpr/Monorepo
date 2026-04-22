/**
 * CreateInvoiceClient — 3-step invoice creation wizard.
 * Used by: /admin/invoices/new
 *
 * Step 1: Select a class session
 * Step 2: Fill in invoice details (recipient, students, price, notes)
 * Step 3: Review and send
 *
 * Handles success state inline — replaces the form with a confirmation screen
 * after the invoice is sent without navigating away.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Check } from "lucide-react";
import type { UserRole } from "@/types/users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A class session with pre-computed spot availability passed from the server. */
export interface SessionOption {
  id: string;
  starts_at: string;
  ends_at: string;
  spotsRemaining: number;
  class_types: { id: string; name: string; price: number };
  locations: { name: string; city: string; state: string };
}

/** An instructor profile for the super admin instructor selection step. */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

/** Successful invoice creation result from the API. */
interface SuccessResult {
  invoiceId: string;
  invoiceNumber: string;
  recipientEmail: string;
}

type Step = 1 | 2 | 3;
type InvoiceType = "individual" | "group";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateInvoiceClientProps {
  sessions: SessionOption[];
  preSelectedSessionId: string | null;
  userRole: UserRole;
  /** The instructor whose sessions are shown. Null when super admin has not yet chosen an instructor. */
  instructorId: string | null;
  /** Instructor list for the super admin instructor selection step. Null for instructor-role users. */
  instructors?: InstructorOption[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats an ISO date string to a short human-readable date.
 * e.g. "Mon, Apr 21, 2026"
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats an ISO date string to a 12-hour time string.
 * e.g. "10:30 AM"
 */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats a dollar amount to a USD currency string.
 * e.g. "$75.00"
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Returns the Tailwind color classes for spots remaining badges.
 * Green for 5+, amber for 1–4, red for 0.
 */
function spotsColor(spots: number): string {
  if (spots === 0) return "text-red-600";
  if (spots <= 4) return "text-amber-600";
  return "text-green-600";
}

/**
 * Returns the spots label string for display in session cards.
 */
function spotsLabel(spots: number): string {
  if (spots === 0) return "No spots available";
  if (spots <= 4) return `Only ${spots} spot${spots === 1 ? "" : "s"} left`;
  return `${spots} spots available`;
}

/**
 * Validates an email address using a basic regex check.
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-step invoice creation wizard.
 * Manages all wizard state and communicates with /api/invoices/create on submit.
 */
export default function CreateInvoiceClient({
  sessions,
  preSelectedSessionId,
  instructorId,
  instructors,
}: CreateInvoiceClientProps) {
  // Resolve pre-selected session from the query param if provided
  const preSelected = preSelectedSessionId
    ? (sessions.find((s) => s.id === preSelectedSessionId) ?? null)
    : null;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  // Wizard step — skip to step 2 if a session was pre-selected via query param
  const [step, setStep] = useState<Step>(preSelected ? 2 : 1);

  // Step 1: selected session
  const [selectedSession, setSelectedSession] = useState<SessionOption | null>(
    preSelected
  );

  // Step 2: form fields
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("individual");
  // For individual: recipientName = full name. For group: recipientName = contact name.
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  // Group-only
  const [companyName, setCompanyName] = useState("");
  // Shared
  const [studentCount, setStudentCount] = useState(1);
  const [useCustomPrice, setUseCustomPrice] = useState(false);
  const [customAmount, setCustomAmount] = useState(0);
  const [notes, setNotes] = useState("");

  // Submission
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<SuccessResult | null>(
    null
  );

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  /** Auto-calculated total based on class price × student count. */
  const calculatedTotal = selectedSession
    ? selectedSession.class_types.price * studentCount
    : 0;

  /** The authoritative total to invoice — custom or calculated. */
  const totalAmount = useCustomPrice ? customAmount : calculatedTotal;

  /**
   * Amount per student — used for DB record.
   * For custom prices, divides evenly; for standard, uses class type price.
   */
  const amountPerStudent = useCustomPrice
    ? studentCount > 0
      ? customAmount / studentCount
      : 0
    : (selectedSession?.class_types.price ?? 0);

  /**
   * Whether all Step 2 fields are valid enough to proceed to Step 3.
   * Validates required fields and student count against available spots.
   */
  const isStep2Valid = ((): boolean => {
    if (!selectedSession) return false;
    if (studentCount < 1 || studentCount > selectedSession.spotsRemaining)
      return false;
    if (invoiceType === "individual") {
      return (
        recipientName.trim().length > 0 && isValidEmail(recipientEmail.trim())
      );
    }
    // group
    return (
      companyName.trim().length > 0 &&
      recipientName.trim().length > 0 &&
      isValidEmail(recipientEmail.trim())
    );
  })();

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Selects a session from the Step 1 list and advances to Step 2.
   * Only sessions with available spots can be selected.
   * @param session - The session the instructor clicked on.
   */
  function handleSelectSession(session: SessionOption): void {
    if (session.spotsRemaining === 0) return;
    setSelectedSession(session);
    setStep(2);
  }

  /**
   * Submits the invoice to the API route.
   * On success, stores the result and shows the success screen.
   * On failure, displays an inline error message.
   */
  async function handleSend(): Promise<void> {
    // Guard: instructorId is always set when the wizard is visible (the instructor
    // selector is shown instead when null), but we check here to narrow the type.
    if (!selectedSession || !instructorId) return;

    setIsSending(true);
    setSendError(null);

    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSession.id,
          instructorId,
          invoiceType,
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim(),
          companyName:
            invoiceType === "group" ? companyName.trim() : null,
          studentCount,
          customPrice: useCustomPrice,
          totalAmount,
          amountPerStudent,
          notes: notes.trim() || null,
        }),
      });

      const data: {
        success: boolean;
        error?: string;
        invoiceId?: string;
        invoiceNumber?: string;
      } = await res.json();

      if (!res.ok || !data.success) {
        setSendError(
          data.error ?? "Something went wrong. Please try again."
        );
        return;
      }

      setSuccessResult({
        invoiceId: data.invoiceId!,
        invoiceNumber: data.invoiceNumber!,
        recipientEmail: recipientEmail.trim(),
      });
    } catch {
      setSendError("Network error. Please check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /**
   * Renders the 3-step progress indicator at the top of the page.
   * Active step is highlighted in red; completed steps show a checkmark.
   * @param currentStep - The wizard step currently displayed.
   */
  function renderStepIndicator(currentStep: Step) {
    const steps = [
      { number: 1, label: "Select Class" },
      { number: 2, label: "Invoice Details" },
      { number: 3, label: "Review & Send" },
    ];

    return (
      <nav
        aria-label="Invoice creation progress"
        className="mb-8 flex items-center justify-center gap-0"
      >
        {steps.map((s, idx) => {
          const isCompleted = currentStep > s.number;
          const isActive = currentStep === s.number;

          return (
            <div key={s.number} className="flex items-center">
              {/* Step circle */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                    isCompleted
                      ? "bg-red-600 text-white"
                      : isActive
                        ? "bg-red-600 text-white ring-4 ring-red-100"
                        : "bg-gray-200 text-gray-500",
                  ].join(" ")}
                  aria-current={isActive ? "step" : undefined}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    s.number
                  )}
                </div>
                <span
                  className={[
                    "text-xs font-medium",
                    isActive ? "text-red-600" : "text-gray-500",
                  ].join(" ")}
                >
                  {s.label}
                </span>
              </div>

              {/* Connector line between steps */}
              {idx < steps.length - 1 && (
                <div
                  className={[
                    "mx-3 mb-4 h-0.5 w-16",
                    currentStep > s.number ? "bg-red-600" : "bg-gray-200",
                  ].join(" ")}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </nav>
    );
  }

  /**
   * Renders the session summary bar shown at the top of Steps 2 and 3.
   * Gives the instructor a persistent view of the selected class with a
   * "Change class" link that returns them to Step 1.
   */
  function renderSessionSummary() {
    if (!selectedSession) return null;

    return (
      <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-900">
              {selectedSession.class_types.name}
            </p>
            <p className="text-sm text-gray-600">
              {formatDate(selectedSession.starts_at)} ·{" "}
              {formatTime(selectedSession.starts_at)}–
              {formatTime(selectedSession.ends_at)}
            </p>
            <p className="text-sm text-gray-500">
              {selectedSession.locations.name} ·{" "}
              {selectedSession.locations.city},{" "}
              {selectedSession.locations.state}
            </p>
            <p
              className={`mt-1 text-sm font-medium ${spotsColor(selectedSession.spotsRemaining)}`}
            >
              {spotsLabel(selectedSession.spotsRemaining)}
            </p>
          </div>
          {/* Only show "Change class" in Step 2 — Step 3 has its own "Edit Details" button */}
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              className="shrink-0 text-sm text-red-600 hover:underline"
            >
              Change class
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Step renders
  // ---------------------------------------------------------------------------

  /** Renders the session selection list for Step 1. */
  function renderStep1() {
    if (sessions.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <p className="text-gray-500">
            No approved classes available for invoicing. Classes must have an
            approval status of &ldquo;approved&rdquo; before you can send invoices for them.
          </p>
          <Link
            href="/admin/sessions"
            className="mt-4 inline-block text-sm text-red-600 hover:underline"
          >
            View my classes
          </Link>
        </div>
      );
    }

    return (
      <div>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Select a Class
        </h2>
        <ul className="space-y-3">
          {sessions.map((session) => {
            const isDisabled = session.spotsRemaining === 0;
            const isSelected = selectedSession?.id === session.id;

            return (
              <li key={session.id}>
                <button
                  onClick={() => handleSelectSession(session)}
                  disabled={isDisabled}
                  className={[
                    "w-full rounded-lg border p-4 text-left transition-colors",
                    isDisabled
                      ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
                      : isSelected
                        ? "border-red-500 bg-red-50 ring-2 ring-red-500"
                        : "border-gray-200 bg-white hover:border-red-300 hover:bg-red-50",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {session.class_types.name}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDate(session.starts_at)} ·{" "}
                        {formatTime(session.starts_at)}–
                        {formatTime(session.ends_at)}
                      </p>
                      <p className="text-sm text-gray-500">
                        {session.locations.name} · {session.locations.city},{" "}
                        {session.locations.state}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium ${spotsColor(session.spotsRemaining)}`}
                    >
                      {spotsLabel(session.spotsRemaining)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  /** Renders the invoice details form for Step 2. */
  function renderStep2() {
    return (
      <div>
        {renderSessionSummary()}

        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Invoice Details
        </h2>

        <div className="space-y-6">
          {/* Invoice type toggle */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              Invoice type
            </p>
            <div className="flex rounded-lg border border-gray-300 p-1 w-fit gap-1">
              {(["individual", "group"] as InvoiceType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setInvoiceType(type)}
                  className={[
                    "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                    invoiceType === type
                      ? "bg-red-600 text-white"
                      : "text-gray-600 hover:text-gray-900",
                  ].join(" ")}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Recipient fields — label changes based on type */}
          {invoiceType === "group" && (
            <div>
              <label
                htmlFor="companyName"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Company name <span className="text-red-600">*</span>
              </label>
              <input
                id="companyName"
                type="text"
                required
                aria-required="true"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                placeholder="River Oaks Hospital"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="recipientName"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {invoiceType === "group" ? "Contact name" : "Recipient full name"}{" "}
              <span className="text-red-600">*</span>
            </label>
            <input
              id="recipientName"
              type="text"
              required
              aria-required="true"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder={
                invoiceType === "group"
                  ? "Jane Smith"
                  : "Sarah Johnson"
              }
            />
          </div>

          <div>
            <label
              htmlFor="recipientEmail"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {invoiceType === "group" ? "Contact email" : "Recipient email"}{" "}
              <span className="text-red-600">*</span>
            </label>
            <input
              id="recipientEmail"
              type="email"
              required
              aria-required="true"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder={
                invoiceType === "group"
                  ? "jane.smith@company.org"
                  : "sarah.johnson@email.com"
              }
            />
          </div>

          {/* Student count */}
          <div>
            <label
              htmlFor="studentCount"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Number of students <span className="text-red-600">*</span>
            </label>
            <input
              id="studentCount"
              type="number"
              required
              aria-required="true"
              min={1}
              max={selectedSession?.spotsRemaining ?? 1}
              value={studentCount}
              onChange={(e) =>
                setStudentCount(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
              className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            {/* Inline error if student count exceeds available spots */}
            {selectedSession &&
              studentCount > selectedSession.spotsRemaining && (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  Only {selectedSession.spotsRemaining} spot
                  {selectedSession.spotsRemaining === 1 ? "" : "s"} available
                  for this class.
                </p>
              )}
          </div>

          {/* Price */}
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">
              Total amount to invoice
            </p>
            {!useCustomPrice ? (
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold text-gray-900">
                  {formatCurrency(calculatedTotal)}
                </span>
                <span className="text-sm text-gray-400">
                  ({formatCurrency(selectedSession?.class_types.price ?? 0)}{" "}
                  × {studentCount})
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  id="customAmount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={customAmount}
                  onChange={(e) =>
                    setCustomAmount(
                      Math.max(0, parseFloat(e.target.value) || 0)
                    )
                  }
                  className="w-36 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            )}
            <button
              onClick={() => {
                // Pre-fill the custom amount field with the calculated total when toggling on
                if (!useCustomPrice) setCustomAmount(calculatedTotal);
                setUseCustomPrice((prev) => !prev);
              }}
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              {useCustomPrice ? "Use standard price" : "Use custom price"}
            </button>
          </div>

          {/* Optional note */}
          <div>
            <label
              htmlFor="notes"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Note to recipient{" "}
              <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="notes"
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="e.g. Corporate rate agreed, includes all 10 staff members"
            />
            <p className="mt-1 text-right text-xs text-gray-400">
              {notes.length}/500
            </p>
          </div>

          {/* Navigation */}
          <button
            onClick={() => setStep(3)}
            disabled={!isStep2Valid}
            className="w-full rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next: Review →
          </button>
        </div>
      </div>
    );
  }

  /** Renders the review-and-send preview for Step 3. */
  function renderStep3() {
    if (!selectedSession) return null;

    return (
      <div>
        {renderSessionSummary()}

        <h2 className="mb-4 text-xl font-semibold text-gray-900">
          Review & Send
        </h2>

        {/* Preview card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400">
            Invoice Preview
          </p>

          <div className="space-y-3 text-gray-700">
            <div>
              <span className="text-xs font-semibold uppercase text-gray-400">
                Invoice #
              </span>
              <p className="font-mono text-gray-900">
                Will be assigned on send
              </p>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-gray-400">
                To
              </span>
              <p className="text-gray-900">{recipientName}</p>
              <p className="text-gray-500">{recipientEmail}</p>
              {invoiceType === "group" && companyName && (
                <p className="text-gray-500">{companyName}</p>
              )}
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-gray-400">
                Class
              </span>
              <p className="text-gray-900">
                {selectedSession.class_types.name}
              </p>
              <p className="text-gray-500">
                {formatDate(selectedSession.starts_at)} ·{" "}
                {formatTime(selectedSession.starts_at)}–
                {formatTime(selectedSession.ends_at)}
              </p>
              <p className="text-gray-500">
                {selectedSession.locations.name},{" "}
                {selectedSession.locations.city},{" "}
                {selectedSession.locations.state}
              </p>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-gray-400">
                Students
              </span>
              <p className="text-gray-900">{studentCount}</p>
            </div>

            <div>
              <span className="text-xs font-semibold uppercase text-gray-400">
                Amount
              </span>
              <p className="flex items-center gap-2 text-gray-900">
                {formatCurrency(totalAmount)}
                {useCustomPrice && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    Custom price
                  </span>
                )}
              </p>
            </div>

            {notes.trim() && (
              <div>
                <span className="text-xs font-semibold uppercase text-gray-400">
                  Note
                </span>
                <p className="text-gray-700">{notes.trim()}</p>
              </div>
            )}
          </div>
        </div>

        {/* Error message */}
        {sendError && (
          <div
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {sendError}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => {
              setSendError(null);
              setStep(2);
            }}
            disabled={isSending}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            ← Edit Details
          </button>
          <button
            onClick={handleSend}
            disabled={isSending}
            className="flex-1 rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSending ? "Sending..." : "Send Invoice"}
          </button>
        </div>
      </div>
    );
  }

  /**
   * Renders the instructor selection step for super admins who have no instructor
   * context yet. Clicking an instructor navigates to ?instructor=[id], which causes
   * the server component to reload scoped to that instructor's approved sessions.
   */
  function renderInstructorSelector() {
    const list = instructors ?? [];

    if (list.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <p className="text-gray-500">No active instructors found.</p>
          <Link
            href="/admin/staff"
            className="mt-4 inline-block text-sm text-red-600 hover:underline"
          >
            Manage staff
          </Link>
        </div>
      );
    }

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Select an Instructor</h2>
          <p className="mt-1 text-sm text-gray-500">
            Choose which instructor you are creating this invoice for.
          </p>
        </div>
        <ul className="space-y-2">
          {list.map((instructor) => (
            <li key={instructor.id}>
              <Link
                href={`?instructor=${instructor.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-red-300 hover:bg-red-50"
              >
                <span className="font-medium text-gray-900">
                  {instructor.first_name} {instructor.last_name}
                </span>
                <span className="text-sm text-red-600">Select →</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /** Renders the success confirmation screen shown after a successful send. */
  function renderSuccess() {
    if (!successResult) return null;

    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Invoice sent!</h2>
          <p className="mt-2 text-gray-500">
            Invoice{" "}
            <span className="font-mono font-semibold text-gray-900">
              {successResult.invoiceNumber}
            </span>{" "}
            has been sent to{" "}
            <span className="font-semibold">{successResult.recipientEmail}</span>.
          </p>
        </div>
        <div className="flex gap-4">
          <Link
            href={`/admin/invoices/${successResult.invoiceId}`}
            className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            View invoice
          </Link>
          <Link
            href="/admin/invoices/new"
            className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Send another invoice
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  // Super admin without an instructor context — show instructor selector instead of wizard.
  if (!instructorId) {
    return renderInstructorSelector();
  }

  if (successResult) {
    return renderSuccess();
  }

  return (
    <div>
      {renderStepIndicator(step)}

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
    </div>
  );
}

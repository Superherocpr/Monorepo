"use client";

/**
 * Multi-step roster upload form for group class contacts on /submit-roster.
 * Step 1: Enter invoice number → Step 2: Confirm class details →
 * Step 3: Upload file (optional name + email) → Step 4: Success confirmation.
 * Used by: SubmitRosterPage (app/(public)/submit-roster/page.tsx).
 */

import { useEffect, useRef, useState } from "react";

type Step = 1 | 2 | 3 | 4;

/** Session details returned by the lookup API and displayed in Step 2. */
interface SessionDetails {
  className: string;
  date: string;
  time: string;
  locationName: string;
  locationCity: string;
  locationState: string;
  instructorName: string;
}

/** Shape of the response from POST /api/roster-upload/lookup. */
interface LookupResponse {
  valid: boolean;
  session: SessionDetails | null;
  invoiceId: string | null;
  sessionId: string | null;
  invoiceNumber: string | null;
  error?: string;
}

/** Shape of the response from POST /api/roster-upload/submit. */
interface SubmitResponse {
  success: boolean;
  error?: string;
}

interface SubmitRosterClientProps {
  /** Pre-filled invoice number from the ?invoice= URL query param. If provided,
   *  the invoice lookup runs automatically on mount and skips Step 1. */
  prefilledInvoice: string | null;
}

/**
 * Renders the four-step roster submission flow.
 * @param prefilledInvoice - Optional invoice number from the URL query param.
 */
export default function SubmitRosterClient({ prefilledInvoice }: SubmitRosterClientProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [invoiceInput, setInvoiceInput] = useState(prefilledInvoice ?? "");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Step 2 (populated by lookup)
  const [sessionDetails, setSessionDetails] = useState<SessionDetails | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);

  // Step 3
  const [file, setFile] = useState<File | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 4
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-advance when invoice number is pre-filled via query param — runs once on mount
  useEffect(() => {
    if (prefilledInvoice) {
      performLookup(prefilledInvoice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Calls POST /api/roster-upload/lookup, validates the invoice number,
   * stores session details in state, and advances to Step 2 on success.
   * @param number - The raw invoice number string to look up.
   */
  async function performLookup(number: string) {
    setLookupLoading(true);
    setLookupError(null);

    try {
      const res = await fetch("/api/roster-upload/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceNumber: number }),
      });

      const data = (await res.json()) as LookupResponse;

      if (!data.valid || !data.session || !data.invoiceId || !data.sessionId) {
        setLookupError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setSessionDetails(data.session);
      setInvoiceId(data.invoiceId);
      setSessionId(data.sessionId);
      setInvoiceNumber(data.invoiceNumber);
      setStep(2);
    } catch {
      setLookupError("Something went wrong. Please check your connection and try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  /** Handles the Step 1 form submit — validates the input and calls performLookup. */
  function handleLookup() {
    if (!invoiceInput.trim()) {
      setLookupError("Please enter your invoice number.");
      return;
    }
    performLookup(invoiceInput.trim());
  }

  /**
   * Stores the selected file in state and, for CSV files, reads the content
   * to count the number of data rows so the customer can confirm the right file.
   * @param selectedFile - File object from input change or drag-drop event.
   */
  async function handleFileSelected(selectedFile: File) {
    const name = selectedFile.name.toLowerCase();
    const isCsv =
      selectedFile.type === "text/csv" ||
      selectedFile.type === "text/plain" ||
      name.endsWith(".csv");
    const isExcel =
      selectedFile.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      selectedFile.type === "application/vnd.ms-excel" ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls");

    if (!isCsv && !isExcel) {
      setSubmitError("Please upload a CSV or Excel file (.csv, .xlsx, .xls).");
      return;
    }

    setFile(selectedFile);
    setSubmitError(null);

    if (isCsv) {
      // Count data rows client-side for CSV so the customer can sanity-check the file.
      // Subtract 1 for the header row.
      try {
        const text = await selectedFile.text();
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        setRowCount(Math.max(0, lines.length - 1));
      } catch {
        setRowCount(null);
      }
    } else {
      // Row count isn't available for Excel without a parsing library
      setRowCount(null);
    }
  }

  /** Handles the native file input change event. */
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) handleFileSelected(selected);
  }

  /** Handles drag-over on the drop zone — signals an active drag. */
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  /** Handles drag-leave on the drop zone — clears the active drag state. */
  function handleDragLeave() {
    setIsDragging(false);
  }

  /** Handles file drop on the drop zone. */
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelected(dropped);
  }

  /**
   * Builds a FormData payload and calls POST /api/roster-upload/submit.
   * Advances to Step 4 on success.
   */
  async function handleSubmit() {
    if (!file || !invoiceId || !sessionId) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("invoiceId", invoiceId);
      formData.append("sessionId", sessionId);
      if (invoiceNumber) formData.append("invoiceNumber", invoiceNumber);
      if (submitterName.trim()) formData.append("submittedByName", submitterName.trim());
      if (submitterEmail.trim()) formData.append("submittedByEmail", submitterEmail.trim());

      const res = await fetch("/api/roster-upload/submit", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as SubmitResponse;

      if (!data.success) {
        setSubmitError(data.error ?? "Submission failed. Please try again.");
        return;
      }

      // Save the email before clearing state so Step 4 can display it
      setConfirmedEmail(submitterEmail.trim() || null);
      setStep(4);
    } catch {
      setSubmitError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Resets all form state so the customer can submit another roster from Step 1.
   * Preserves nothing — a fresh start.
   */
  function handleReset() {
    setStep(1);
    setInvoiceInput("");
    setLookupError(null);
    setSessionDetails(null);
    setInvoiceId(null);
    setSessionId(null);
    setInvoiceNumber(null);
    setFile(null);
    setRowCount(null);
    setSubmitterName("");
    setSubmitterEmail("");
    setSubmitError(null);
    setConfirmedEmail(null);
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">

        {/* ── Step 1: Enter Invoice Number ─────────────────────────────────── */}
        {step === 1 && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Submit Your Class Roster</h1>
              <p className="mt-3 text-gray-600 leading-relaxed">
                If you received a group invoice for CPR training, use this page to submit
                your staff roster in advance. This helps us prepare for your class and
                saves time on the day.
              </p>
              <p className="mt-2 text-gray-600 leading-relaxed">
                You&apos;ll need the invoice number from your invoice email.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="invoice-number" className="block text-sm font-medium text-gray-700">
                Invoice Number
              </label>
              <input
                id="invoice-number"
                type="text"
                value={invoiceInput}
                onChange={(e) => {
                  setInvoiceInput(e.target.value);
                  setLookupError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLookup();
                }}
                placeholder="e.g. INV-00042"
                className="block w-full border border-gray-300 rounded-md px-4 py-3 font-mono text-lg tracking-wider focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                disabled={lookupLoading}
                autoFocus={!prefilledInvoice}
              />
              {lookupError && (
                <p className="text-sm text-red-600">{lookupError}</p>
              )}
            </div>

            <button
              onClick={handleLookup}
              disabled={lookupLoading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold py-3 px-6 rounded-md transition-colors"
            >
              {lookupLoading ? "Looking up…" : "Find My Class"}
            </button>
          </div>
        )}

        {/* ── Step 2: Confirm Class Details ────────────────────────────────── */}
        {step === 2 && sessionDetails && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Confirm Your Class</h1>
              <p className="mt-2 text-gray-600">
                Please confirm this is the right class before uploading your roster.
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-5 space-y-3">
              <DetailRow label="Class" value={sessionDetails.className} />
              <DetailRow label="Date" value={sessionDetails.date} />
              <DetailRow label="Time" value={sessionDetails.time} />
              <DetailRow
                label="Location"
                value={`${sessionDetails.locationName}, ${sessionDetails.locationCity}, ${sessionDetails.locationState}`}
              />
              <DetailRow label="Instructor" value={sessionDetails.instructorName} />
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setStep(3)}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-md transition-colors"
              >
                This is my class
              </button>
              <button
                onClick={() => {
                  setStep(1);
                  setSessionDetails(null);
                  setLookupError(null);
                }}
                className="w-full text-sm text-gray-500 hover:text-gray-700 underline"
              >
                That&apos;s not right — go back
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Upload Roster ─────────────────────────────────────────── */}
        {step === 3 && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Upload your staff list</h1>
              <p className="mt-3 text-gray-600 leading-relaxed">
                Please upload a spreadsheet with your staff&apos;s information.
                We accept Excel (.xlsx) or CSV files.
              </p>
              <div className="mt-3 text-sm text-gray-500 space-y-1">
                <p>
                  <span className="font-medium text-gray-700">Required columns:</span>{" "}
                  First Name, Last Name
                </p>
                <p>
                  <span className="font-medium text-gray-700">Optional columns:</span>{" "}
                  Email, Phone, Employer / Department
                </p>
                <p className="text-gray-400">
                  Column names don&apos;t need to match exactly — we&apos;ll help you map them.
                </p>
              </div>
            </div>

            {/* Drag-and-drop file zone */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-red-400 bg-red-50"
                  : file
                  ? "border-green-400 bg-green-50"
                  : "border-gray-300 hover:border-gray-400 bg-gray-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileInputChange}
              />
              {file ? (
                <div className="space-y-1">
                  <p className="font-medium text-gray-900">{file.name}</p>
                  {rowCount !== null ? (
                    <p className="text-sm text-gray-500">
                      {rowCount} {rowCount === 1 ? "person" : "people"} found
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">
                      {(file.size / 1024).toFixed(0)} KB
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">Click to choose a different file</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-gray-600">Drag and drop your file here</p>
                  <p className="text-sm text-gray-400">or click to browse</p>
                  <p className="text-xs text-gray-400 mt-2">
                    CSV, Excel (.xlsx, .xls) — max 10MB
                  </p>
                </div>
              )}
            </div>

            {/* Optional submitter info */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">
                Optional — so we can send you a confirmation
              </p>
              <input
                type="text"
                placeholder="Your name"
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
              <input
                type="email"
                placeholder="Your email"
                value={submitterEmail}
                onChange={(e) => setSubmitterEmail(e.target.value)}
                className="block w-full border border-gray-300 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            {submitError && (
              <p className="text-sm text-red-600">{submitError}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!file || submitting}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold py-3 px-6 rounded-md transition-colors"
            >
              {submitting ? "Uploading…" : "Submit Roster"}
            </button>
          </div>
        )}

        {/* ── Step 4: Confirmation ──────────────────────────────────────────── */}
        {step === 4 && (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center space-y-4">
            <div className="flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
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
            </div>

            <h1 className="text-2xl font-bold text-gray-900">Roster submitted!</h1>

            <p className="text-gray-600 leading-relaxed">
              Your staff list has been received. Our team will review it before class day.
            </p>
            <p className="text-gray-600 leading-relaxed">
              If you need to make any changes, you can resubmit using the same invoice number.
            </p>

            {confirmedEmail && (
              <p className="text-sm text-gray-500">
                A confirmation has been sent to{" "}
                <span className="font-medium text-gray-700">{confirmedEmail}</span>.
              </p>
            )}

            <button
              onClick={handleReset}
              className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
            >
              Submit another roster
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

/**
 * Two-column label/value row used in the Step 2 class confirmation card.
 * @param label - Short descriptor (e.g. "Class", "Date").
 * @param value - The value to display.
 */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <span className="text-sm font-medium text-gray-500 w-24 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}

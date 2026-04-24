/**
 * RosterCorrectionClient — interactive student correction UI for /roster/[session_token].
 * Handles name search, record selection with device-token locking, view/edit mode,
 * and the PATCH /api/roster/confirm call.
 * Used by: app/(public)/roster/[session_token]/page.tsx
 */

"use client";

import { useState, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single student's roster record, as passed from the server page. */
export interface RosterRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  confirmed: boolean;
  /** True if another device has already claimed this record. */
  hasDeviceToken: boolean;
}

interface Props {
  sessionId: string;
  classTypeName: string;
  locationName: string;
  startsAt: string;
  correctionWindowClosesAt: string;
  records: RosterRecord[];
}

/** Fields that can be edited by the student. */
interface EditFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employer: string;
}

/** Current view the student sees. */
type View = "search" | "record" | "confirmed" | "device_mismatch";

// ── LocalStorage key for device tokens ───────────────────────────────────────

/** Returns the localStorage key used to lock this record to this device. */
function deviceTokenKey(recordId: string): string {
  return `roster_token_${recordId}`;
}

/**
 * Gets or generates the device token for a given record. Stores it in
 * localStorage so this device is recognized on return visits.
 * @param recordId - The roster_record UUID
 */
function getOrCreateDeviceToken(recordId: string): string {
  const existing = localStorage.getItem(deviceTokenKey(recordId));
  if (existing) return existing;
  const newToken = crypto.randomUUID();
  localStorage.setItem(deviceTokenKey(recordId), newToken);
  return newToken;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp for display (e.g. "Monday, April 22 at 9:00 AM").
 * @param iso - ISO timestamp string
 */
function formatDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Wrapper card used throughout the page. */
function PageCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-start justify-center pt-8 px-4 pb-16">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

/** Labeled read-only field row. */
function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-gray-900 mt-0.5">{value || <span className="text-gray-400 italic">Not provided</span>}</p>
    </div>
  );
}

/** Labeled editable input field. */
function EditField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
        required={required}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

/**
 * Full interactive roster correction flow:
 * 1. Search by name
 * 2. Select record (device-token locked after first selection + confirm)
 * 3. Confirm or edit
 * 4. Success state
 * @param props - Session and roster data from the server page
 */
export default function RosterCorrectionClient({
  sessionId,
  classTypeName,
  startsAt,
  correctionWindowClosesAt,
  records,
}: Props) {
  const [view, setView] = useState<View>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<RosterRecord | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<EditFields>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    employer: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The final confirmed details shown in the success state. */
  const [confirmedDetails, setConfirmedDetails] = useState<EditFields | null>(null);

  /** Live search filter — matches against first or last name. */
  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.firstName.toLowerCase().includes(q) ||
        r.lastName.toLowerCase().includes(q)
    );
  }, [records, searchQuery]);

  /** Whether the correction window is currently open (checked at render time). */
  const isWindowOpen = correctionWindowClosesAt
    ? new Date(correctionWindowClosesAt) > new Date()
    : false;

  /**
   * Called when a student taps their name in the search results.
   * Handles device-token logic and routes to the right view.
   * @param record - The roster record that was tapped
   */
  function handleSelectRecord(record: RosterRecord) {
    // Get or create a device token for this record on this device
    const localToken = localStorage.getItem(deviceTokenKey(record.id));

    // If another device has already locked this record and we don't have the token,
    // show the device mismatch message immediately — the server would reject us anyway.
    if (!localToken && record.hasDeviceToken) {
      setSelectedRecord(record);
      setView("device_mismatch");
      return;
    }

    // Pre-populate edit fields from the record
    setEditFields({
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email ?? "",
      phone: record.phone ?? "",
      employer: record.employer ?? "",
    });
    setSelectedRecord(record);
    setEditMode(false);
    setSaveError(null);
    setView("record");
  }

  /**
   * Sends the PATCH /api/roster/confirm request with the current fields.
   * On success: transitions to confirmed state.
   * On device mismatch: transitions to device_mismatch state.
   * On window closed: shows inline error.
   * @param fields - The final field values to save
   */
  async function handleConfirm(fields: EditFields) {
    if (!selectedRecord) return;
    setSaving(true);
    setSaveError(null);

    const deviceToken = getOrCreateDeviceToken(selectedRecord.id);

    try {
      const res = await fetch("/api/roster/confirm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selectedRecord.id,
          deviceToken,
          updates: {
            firstName: fields.firstName.trim(),
            lastName: fields.lastName.trim(),
            email: fields.email.trim().toLowerCase(),
            phone: fields.phone.trim() || null,
            employer: fields.employer.trim() || null,
          },
        }),
      });

      const data = (await res.json()) as { success: boolean; error?: string };

      if (!res.ok) {
        if (data.error === "Device mismatch.") {
          setView("device_mismatch");
          return;
        }
        if (data.error === "Correction window closed.") {
          setSaveError(
            "The correction window has just closed. Your changes could not be saved. Please speak to your instructor."
          );
          return;
        }
        setSaveError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Success — show the confirmation state with the saved details
      setConfirmedDetails(fields);
      setView("confirmed");
    } catch {
      setSaveError("A network error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  // ── View: device mismatch ──────────────────────────────────────────────────
  if (view === "device_mismatch") {
    return (
      <PageCard>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 text-center space-y-3">
          <div className="text-3xl">🔒</div>
          <p className="text-gray-800 font-medium">
            This record has already been confirmed from another device.
          </p>
          <p className="text-gray-500 text-sm">
            If this was you, you&apos;re all set. If not, please speak to your instructor.
          </p>
          <button
            onClick={() => { setView("search"); setSelectedRecord(null); }}
            className="mt-2 text-red-600 text-sm font-medium underline"
          >
            Back to search
          </button>
        </div>
      </PageCard>
    );
  }

  // ── View: confirmed ────────────────────────────────────────────────────────
  if (view === "confirmed" && confirmedDetails) {
    return (
      <PageCard>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 space-y-4">
          <div className="text-center space-y-2">
            {/* Green checkmark */}
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">You&apos;re all set!</h1>
            <p className="text-gray-500 text-sm">
              Your information has been confirmed for{" "}
              <span className="font-medium text-gray-700">{classTypeName}</span> on{" "}
              <span className="font-medium text-gray-700">{formatDateTime(startsAt)}</span>.
            </p>
          </div>
          <div className="border-t border-gray-100 pt-4 space-y-1">
            <FieldRow label="First name" value={confirmedDetails.firstName} />
            <FieldRow label="Last name" value={confirmedDetails.lastName} />
            <FieldRow label="Email" value={confirmedDetails.email} />
            <FieldRow label="Phone" value={confirmedDetails.phone} />
            <FieldRow label="Employer" value={confirmedDetails.employer} />
          </div>
        </div>
      </PageCard>
    );
  }

  // ── View: record (view or edit mode) ──────────────────────────────────────
  if (view === "record" && selectedRecord) {
    // Check if this is a revisit from the same device with an already-confirmed record
    const localToken = localStorage.getItem(deviceTokenKey(selectedRecord.id));
    const isAlreadyConfirmedSameDevice = selectedRecord.confirmed && !!localToken;

    return (
      <PageCard>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-gray-100">
            <button
              onClick={() => { setView("search"); setEditMode(false); setSaveError(null); }}
              className="text-sm text-gray-500 flex items-center gap-1 mb-3"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {selectedRecord.firstName} {selectedRecord.lastName}
              </h2>
              {isAlreadyConfirmedSameDevice && (
                <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  Confirmed
                </span>
              )}
            </div>
            {isAlreadyConfirmedSameDevice && (
              <p className="text-sm text-gray-500 mt-1">Already confirmed</p>
            )}
          </div>

          {/* Fields */}
          <div className="px-4 py-3">
            {editMode ? (
              // ── Edit mode ──────────────────────────────────────────────────
              <form
                onSubmit={(e) => { e.preventDefault(); handleConfirm(editFields); }}
                className="space-y-3"
              >
                <EditField
                  label="First name"
                  value={editFields.firstName}
                  onChange={(v) => setEditFields((f) => ({ ...f, firstName: v }))}
                  required
                />
                <EditField
                  label="Last name"
                  value={editFields.lastName}
                  onChange={(v) => setEditFields((f) => ({ ...f, lastName: v }))}
                  required
                />
                <EditField
                  label="Email"
                  value={editFields.email}
                  onChange={(v) => setEditFields((f) => ({ ...f, email: v }))}
                  type="email"
                  required
                />
                <EditField
                  label="Phone"
                  value={editFields.phone}
                  onChange={(v) => setEditFields((f) => ({ ...f, phone: v }))}
                  type="tel"
                />
                <EditField
                  label="Employer"
                  value={editFields.employer}
                  onChange={(v) => setEditFields((f) => ({ ...f, employer: v }))}
                />

                {saveError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{saveError}</p>
                )}

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
                  >
                    {saving ? "Saving…" : "Save & Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditMode(false); setSaveError(null); }}
                    className="w-full text-gray-600 border border-gray-300 font-medium py-3 rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              // ── View mode ──────────────────────────────────────────────────
              <div className="space-y-1">
                <FieldRow label="First name" value={editFields.firstName} />
                <FieldRow label="Last name" value={editFields.lastName} />
                <FieldRow label="Email" value={editFields.email} />
                <FieldRow label="Phone" value={editFields.phone} />
                <FieldRow label="Employer" value={editFields.employer} />
              </div>
            )}
          </div>

          {/* Actions — view mode only */}
          {!editMode && (
            <div className="px-4 pb-4 pt-2 flex flex-col gap-2">
              {saveError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-1">{saveError}</p>
              )}

              {isAlreadyConfirmedSameDevice ? (
                // ── Already confirmed — offer to re-edit if window is still open ──
                isWindowOpen && (
                  <button
                    onClick={() => { setEditMode(true); setSaveError(null); }}
                    className="w-full text-gray-700 border border-gray-300 font-medium py-3 rounded-lg text-sm"
                  >
                    Need to make a change?
                  </button>
                )
              ) : (
                // ── Normal flow — confirm or edit ──────────────────────────────
                <>
                  <button
                    onClick={() => handleConfirm(editFields)}
                    disabled={saving}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
                  >
                    {saving ? "Confirming…" : "Everything looks correct"}
                  </button>
                  <button
                    onClick={() => setEditMode(true)}
                    className="w-full text-gray-700 border border-gray-300 font-medium py-3 rounded-lg"
                  >
                    Update my information
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </PageCard>
    );
  }

  // ── View: search (default) ─────────────────────────────────────────────────
  return (
    <PageCard>
      <div className="space-y-4">
        {/* Session header */}
        <div className="text-center pt-2">
          <h1 className="text-xl font-bold text-gray-900">{classTypeName}</h1>
          <p className="text-sm text-gray-500 mt-1">{formatDateTime(startsAt)}</p>
        </div>

        {/* Instructions */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
          <p className="text-gray-700 text-sm">
            Find your name below to confirm or correct your information.
          </p>
        </div>

        {/* Search input */}
        <input
          type="search"
          placeholder="Search by first or last name…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 text-base bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        {/* Results list */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm divide-y divide-gray-100 overflow-hidden">
          {filteredRecords.length === 0 && searchQuery.trim() !== "" ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              No results for &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            filteredRecords.map((record) => (
              <button
                key={record.id}
                onClick={() => handleSelectRecord(record)}
                className="w-full text-left px-4 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {record.firstName} {record.lastName}
                  </p>
                  {record.employer && (
                    <p className="text-xs text-gray-500 mt-0.5">{record.employer}</p>
                  )}
                </div>
                {record.confirmed && (
                  <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2">
                    ✓
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Not on the list */}
        <p className="text-sm text-gray-500 text-center pb-4">
          Don&apos;t see your name? Your instructor can add you.{" "}
          Alternatively, go to{" "}
          <a href="/rollcall" className="text-red-600 underline">
            superherocpr.com/rollcall
          </a>{" "}
          to check in.
        </p>
      </div>
    </PageCard>
  );
}

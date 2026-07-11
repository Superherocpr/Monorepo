"use client";

/**
 * BulkCreateSessionClient — two-step form for creating multiple class sessions at once.
 * Step 1 (form): shared settings (class type, instructor, location, duration, defaults)
 *   plus a table of per-session rows (date, start time, capacity, notes).
 * Step 2 (review): read-only summary of everything before final submission.
 * Used by: app/(admin)/admin/sessions/bulk/page.tsx
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AddLocationPanel, {
  type NewLocationResult,
} from "@/app/(admin)/_components/AddLocationPanel";
import type {
  ClassTypeOption,
  LocationOption,
  InstructorOption,
} from "../../new/_components/CreateSessionClient";

// ── Re-export so the page can import from one place ───────────────────────────
export type { ClassTypeOption, LocationOption, InstructorOption };

// ── Types ─────────────────────────────────────────────────────────────────────

/** Settings shared across every session in the batch. */
interface SharedSettings {
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  /** Duration in minutes — auto-filled from class type, editable. */
  duration_minutes: string;
  /** Default capacity pre-filled into new rows; editable per row. */
  default_capacity: string;
  /** Default notes pre-filled into new rows; editable per row. */
  default_notes: string;
}

/** One session row in the batch table. */
interface SessionRow {
  /** Stable local key for React — never sent to the server. */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24-hour) */
  start_time: string;
  /** String for <input type="number"> binding; converted to int on submit. */
  max_capacity: string;
  notes: string;
}

interface BulkCreateSessionClientProps {
  classTypes: ClassTypeOption[];
  locations: LocationOption[];
  /** Non-empty only for manager and super admin roles. */
  instructors: InstructorOption[];
  /** Whether the viewing user is an instructor (hides instructor selector). */
  isInstructor: boolean;
  /**
   * Full name of the logged-in user. Only provided when isInstructor is true —
   * displayed in a read-only row instead of the instructor selector.
   */
  instructorName?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts a local date string and time string to a UTC ISO timestamp.
 * Relies on the browser's local timezone — appropriate since staff are always
 * in the same timezone as the classes they schedule.
 * @param date - YYYY-MM-DD
 * @param time - HH:MM (24-hour)
 */
function toISO(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Computes a human-readable duration label from a number of minutes.
 * Examples: "30 min", "2 hrs", "1 hr 30 min". Returns null for invalid input.
 * @param minutes - Duration in minutes.
 */
function durationLabel(minutes: number): string | null {
  if (isNaN(minutes) || minutes < 1) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr${h !== 1 ? "s" : ""}`;
  return `${h} hr${h !== 1 ? "s" : ""} ${m} min`;
}

/**
 * Formats a YYYY-MM-DD string for display. Returns "—" for empty input.
 * @param dateStr - YYYY-MM-DD
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats an HH:MM (24-hour) string to 12-hour display. Returns "—" for empty input.
 * @param timeStr - HH:MM
 */
function formatTime(timeStr: string): string {
  if (!timeStr) return "—";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Computes the end time string for a session given its start and duration.
 * @param date - YYYY-MM-DD
 * @param startTime - HH:MM
 * @param durationMins - Duration in minutes.
 */
function computeEndTime(date: string, startTime: string, durationMins: number): string {
  const dt = new Date(`${date}T${startTime}:00`);
  dt.setMinutes(dt.getMinutes() + durationMins);
  return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ── Component ─────────────────────────────────────────────────────────────────

const EMPTY_SHARED: SharedSettings = {
  class_type_id: "",
  instructor_id: "",
  location_id: "",
  duration_minutes: "",
  default_capacity: "",
  default_notes: "",
};

/**
 * Renders the two-step bulk session creation form.
 * Step 1: fill shared settings and add per-session rows.
 * Step 2: review summary, then submit all to /api/sessions/bulk.
 */
export default function BulkCreateSessionClient({
  classTypes,
  locations,
  instructors,
  isInstructor,
  instructorName,
}: BulkCreateSessionClientProps): React.ReactElement {
  const router = useRouter();

  const [step, setStep] = useState<"form" | "review">("form");
  const [shared, setShared] = useState<SharedSettings>(EMPTY_SHARED);
  const [rows, setRows] = useState<SessionRow[]>([makeRow("1", "", "")]);
  const [autoFilled, setAutoFilled] = useState(false);
  const [locationList, setLocationList] = useState<LocationOption[]>(locations);
  const [showAddLocationPanel, setShowAddLocationPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonically increasing counter used to generate stable row keys.
  const rowCounter = useRef(1);

  /** Creates a new empty session row pre-filled with shared defaults. */
  function makeRow(id: string, capacity: string, notes: string): SessionRow {
    return { id, date: "", start_time: "", max_capacity: capacity, notes };
  }

  /** Returns the next unique row id string. */
  function nextId(): string {
    rowCounter.current += 1;
    return String(rowCounter.current);
  }

  // ── Shared-settings handlers ───────────────────────────────────────────────

  /**
   * Updates a single shared settings field.
   * @param field - The SharedSettings key to update.
   * @param value - New string value.
   */
  function setSharedField(field: keyof SharedSettings, value: string): void {
    if (field === "duration_minutes" || field === "default_capacity") setAutoFilled(false);
    setShared((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Handles class-type selection. Auto-fills duration and default capacity
   * from the class type's defaults; marks both as auto-filled.
   * @param id - Selected class_type_id.
   */
  function handleClassTypeChange(id: string): void {
    const type = classTypes.find((t) => t.id === id);
    setShared((prev) => ({
      ...prev,
      class_type_id: id,
      duration_minutes: type ? String(type.duration_minutes / 60) : prev.duration_minutes,
      default_capacity: type ? String(type.max_capacity) : prev.default_capacity,
    }));
    if (type) setAutoFilled(true);
  }

  // ── Row handlers ───────────────────────────────────────────────────────────

  /**
   * Appends a new session row. The start time is copied from the last row
   * (so back-to-back sessions at the same time need no extra input). Capacity
   * and notes are pre-filled from the current shared defaults.
   */
  function addRow(): void {
    const lastRow = rows[rows.length - 1];
    const id = nextId();
    setRows((prev) => [
      ...prev,
      makeRow(id, shared.default_capacity, shared.default_notes),
    ]);
    // Pre-fill start_time from last row after state update.
    if (lastRow?.start_time) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, start_time: lastRow.start_time } : r
        )
      );
    }
  }

  /**
   * Updates a single field on a specific session row.
   * @param rowId - The row's local id.
   * @param field - The SessionRow key to update.
   * @param value - New string value.
   */
  function updateRow(rowId: string, field: keyof Omit<SessionRow, "id">, value: string): void {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, [field]: value } : r))
    );
  }

  /**
   * Removes a session row by its local id.
   * @param rowId - The row to remove.
   */
  function removeRow(rowId: string): void {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  }

  // ── Step transitions ───────────────────────────────────────────────────────

  /**
   * Validates shared settings and all session rows, then advances to the
   * review step. Shows an inline error and prevents navigation on failure.
   * @param e - Form submit event.
   */
  function handleReview(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);

    if (!shared.class_type_id) {
      setError("Please select a class type.");
      return;
    }
    if (!isInstructor && !shared.instructor_id) {
      setError("Please select an instructor.");
      return;
    }
    if (!shared.location_id) {
      setError("Please select a location.");
      return;
    }
    const durationHours = parseFloat(shared.duration_minutes);
    if (!shared.duration_minutes || isNaN(durationHours) || durationHours <= 0) {
      setError("Please enter a valid duration.");
      return;
    }
    const durationMins = Math.round(durationHours * 60);

    if (rows.length === 0) {
      setError("Add at least one session before reviewing.");
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.date || !r.start_time) {
        setError(`Session ${i + 1}: please enter a date and start time.`);
        return;
      }
      const cap = parseInt(r.max_capacity, 10);
      if (!r.max_capacity || isNaN(cap) || cap < 1) {
        setError(`Session ${i + 1}: please enter a valid capacity.`);
        return;
      }
    }

    setStep("review");
    // Scroll to top so the review header is visible.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Submits all sessions to /api/sessions/bulk. Redirects to the sessions
   * index on success; shows an inline error on failure.
   */
  async function handleSubmit(): Promise<void> {
    setError(null);
    setLoading(true);

    const durationMins = Math.round(parseFloat(shared.duration_minutes) * 60);

    const sessions = rows.map((r) => {
      const starts_at = toISO(r.date, r.start_time);
      const endsDate = new Date(starts_at);
      endsDate.setMinutes(endsDate.getMinutes() + durationMins);
      return {
        starts_at,
        ends_at: endsDate.toISOString(),
        max_capacity: parseInt(r.max_capacity, 10),
        ...(r.notes.trim() ? { notes: r.notes.trim() } : {}),
      };
    });

    const payload: Record<string, unknown> = {
      class_type_id: shared.class_type_id,
      location_id: shared.location_id,
      sessions,
    };

    if (!isInstructor) {
      payload.instructor_id = shared.instructor_id;
    }

    try {
      const res = await fetch("/api/sessions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: string }).error)
            : "Failed to create sessions. Please try again.";
        setError(msg);
        setLoading(false);
        return;
      }

      router.push("/admin/sessions");
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const durationMins = Math.round(parseFloat(shared.duration_minutes) * 60);
  const durationHint = durationLabel(durationMins);

  const selectedClassType = classTypes.find((t) => t.id === shared.class_type_id);
  const selectedLocation = locationList.find((l) => l.id === shared.location_id);
  const selectedInstructor = instructors.find((i) => i.id === shared.instructor_id);

  /** True if any session row has a date/time in the past. */
  const hasPastRows = rows.some(
    (r) =>
      r.date &&
      r.start_time &&
      new Date(`${r.date}T${r.start_time}:00`) < new Date()
  );

  // ── Review step ────────────────────────────────────────────────────────────

  if (step === "review") {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Review Sessions</h1>
            <p className="text-sm text-gray-500 mt-1">
              Check everything carefully — once submitted, sessions go to approval and cannot be edited.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setError(null); setStep("form"); }}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Back to edit
          </button>
        </div>

        {/* Reminder banner */}
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm flex gap-2 items-start"
        >
          <span className="mt-0.5 shrink-0">⚠️</span>
          <span>
            <strong>Please review all sessions below before submitting.</strong> Confirm the dates,
            times, and capacities are correct. Once submitted for approval, sessions cannot be changed.
          </span>
        </div>

        {/* Shared settings summary */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Shared Settings
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-500">Class Type</dt>
              <dd className="text-gray-900 font-medium">{selectedClassType?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Duration</dt>
              <dd className="text-gray-900 font-medium">{durationHint ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Instructor</dt>
              <dd className="text-gray-900 font-medium">
                {isInstructor
                  ? (instructorName ?? "You")
                  : selectedInstructor
                  ? `${selectedInstructor.first_name} ${selectedInstructor.last_name}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Location</dt>
              <dd className="text-gray-900 font-medium">
                {selectedLocation
                  ? `${selectedLocation.name} — ${selectedLocation.city}, ${selectedLocation.state}`
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Sessions table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Sessions{" "}
              <span className="ml-1 bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
                {rows.length}
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">
                    #
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Start
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    End
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Capacity
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isPast =
                    r.date &&
                    r.start_time &&
                    new Date(`${r.date}T${r.start_time}:00`) < new Date();
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-gray-50 last:border-0 ${isPast ? "bg-amber-50" : ""}`}
                    >
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                        {formatDate(r.date)}
                        {isPast && (
                          <span className="ml-1.5 text-amber-600 text-xs font-medium">past</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                        {formatTime(r.start_time)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {!isNaN(durationMins) && durationMins > 0 && r.date && r.start_time
                          ? computeEndTime(r.date, r.start_time, durationMins)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{r.max_capacity}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate">
                        {r.notes.trim() || <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {loading
              ? "Submitting…"
              : `Submit ${rows.length} Session${rows.length !== 1 ? "s" : ""} for Approval`}
          </button>
          <button
            type="button"
            onClick={() => { setError(null); setStep("form"); }}
            className="text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Back to edit
          </button>
        </div>
      </div>
    );
  }

  // ── Form step ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Multiple Sessions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Set shared details once, then add each session date and time below.
          </p>
        </div>
        <Link
          href="/admin/sessions"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to sessions
        </Link>
      </div>

      <form onSubmit={handleReview} noValidate className="space-y-5">
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        {/* ── Shared Settings card ───────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-700">
            Shared Settings
            <span className="ml-2 text-xs font-normal text-gray-400">
              — same for every session in this batch
            </span>
          </h2>

          {/* Class Type */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bs-class-type" className="text-sm font-medium text-gray-700">
              Class Type <span className="text-red-500">*</span>
            </label>
            <select
              id="bs-class-type"
              value={shared.class_type_id}
              onChange={(e) => handleClassTypeChange(e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="">Select a class type…</option>
              {classTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Instructor — selector for managers; read-only for instructors */}
          {!isInstructor ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bs-instructor" className="text-sm font-medium text-gray-700">
                Instructor <span className="text-red-500">*</span>
              </label>
              <select
                id="bs-instructor"
                value={shared.instructor_id}
                onChange={(e) => setSharedField("instructor_id", e.target.value)}
                required
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="">Select an instructor…</option>
                {instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.first_name} {i.last_name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-gray-700">Instructor</span>
              <div className="border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-700">
                {instructorName ?? "You"}
              </div>
            </div>
          )}

          {/* Location */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="bs-location" className="text-sm font-medium text-gray-700">
                Location <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowAddLocationPanel(true)}
                className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
              >
                + Add Location
              </button>
            </div>
            <select
              id="bs-location"
              value={shared.location_id}
              onChange={(e) => setSharedField("location_id", e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="">Select a location…</option>
              {locationList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.city}, {l.state}
                </option>
              ))}
            </select>
          </div>

          {/* Duration + Default Capacity — side by side */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="bs-duration" className="text-sm font-medium text-gray-700">
                  Duration (hours) <span className="text-red-500">*</span>
                </label>
                <input
                  id="bs-duration"
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={shared.duration_minutes}
                  onChange={(e) => setSharedField("duration_minutes", e.target.value)}
                  required
                  placeholder="e.g. 2"
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                {durationHint && (
                  <p className="text-xs text-gray-400">{durationHint}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="bs-default-capacity" className="text-sm font-medium text-gray-700">
                  Default Capacity <span className="text-red-500">*</span>
                </label>
                <input
                  id="bs-default-capacity"
                  type="number"
                  min={1}
                  value={shared.default_capacity}
                  onChange={(e) => setSharedField("default_capacity", e.target.value)}
                  required
                  placeholder="e.g. 20"
                  className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>
            {autoFilled && (
              <p className="text-xs text-gray-400">
                Duration and capacity were auto-filled from the class type — edit if needed.
              </p>
            )}
          </div>

          {/* Default Notes */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bs-default-notes" className="text-sm font-medium text-gray-700">
              Default Notes{" "}
              <span className="text-gray-400 font-normal">(optional — applied to all sessions)</span>
            </label>
            <textarea
              id="bs-default-notes"
              value={shared.default_notes}
              onChange={(e) => setSharedField("default_notes", e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Any details that apply to every session in this batch…"
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-400">
              New sessions will be pre-filled with this value. You can override it per session below.
            </p>
          </div>
        </div>

        {/* ── Session rows card ──────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Sessions{" "}
              <span className="ml-1 bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded-full">
                {rows.length}
              </span>
            </h2>
            {hasPastRows && (
              <span className="text-xs text-amber-600 font-medium">
                ⚠️ One or more sessions are in the past
              </span>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-8">
                    #
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[140px]">
                    Date <span className="text-red-400">*</span>
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[130px]">
                    Start Time <span className="text-red-400">*</span>
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[100px]">
                    Capacity <span className="text-red-400">*</span>
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[180px]">
                    Notes
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>

                    {/* Date */}
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={r.date}
                        onChange={(e) => updateRow(r.id, "date", e.target.value)}
                        aria-label={`Session ${i + 1} date`}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </td>

                    {/* Start Time */}
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={r.start_time}
                        onChange={(e) => updateRow(r.id, "start_time", e.target.value)}
                        aria-label={`Session ${i + 1} start time`}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </td>

                    {/* Capacity */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={r.max_capacity}
                        onChange={(e) => updateRow(r.id, "max_capacity", e.target.value)}
                        aria-label={`Session ${i + 1} capacity`}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.notes}
                        onChange={(e) => updateRow(r.id, "notes", e.target.value)}
                        maxLength={500}
                        placeholder="Optional…"
                        aria-label={`Session ${i + 1} notes`}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </td>

                    {/* Delete */}
                    <td className="px-3 py-2 text-center">
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(r.id)}
                          aria-label={`Remove session ${i + 1}`}
                          className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add session button */}
          <div className="px-5 py-3 border-t border-gray-100">
            <button
              type="button"
              onClick={addRow}
              className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
            >
              + Add session
            </button>
          </div>
        </div>

        {/* Review button */}
        <div className="flex flex-col gap-3 pt-1">
          <button
            type="submit"
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Review {rows.length} Session{rows.length !== 1 ? "s" : ""} →
          </button>
          <Link
            href="/admin/sessions"
            className="block text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Add Location slide-out panel */}
      {showAddLocationPanel && (
        <AddLocationPanel
          onClose={() => setShowAddLocationPanel(false)}
          onAdded={(location: NewLocationResult) => {
            const option: LocationOption = {
              id: location.id,
              name: location.name,
              address: location.address,
              city: location.city,
              state: location.state,
            };
            setLocationList((prev) =>
              [...prev, option].sort((a, b) => a.name.localeCompare(b.name))
            );
            setSharedField("location_id", location.id);
          }}
        />
      )}
    </div>
  );
}

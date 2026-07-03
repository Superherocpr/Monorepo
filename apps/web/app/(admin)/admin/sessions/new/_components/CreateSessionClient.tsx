"use client";

/**
 * CreateSessionClient — form UI for creating a new class session.
 * Used by: app/(admin)/admin/sessions/new/page.tsx
 * Managers and super admins can assign any instructor. Instructors always
 * create sessions for themselves and do not see the instructor selector.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AddLocationPanel, { type NewLocationResult } from "@/app/(admin)/_components/AddLocationPanel";

/** A class type option for the dropdown. */
export interface ClassTypeOption {
  id: string;
  name: string;
  duration_minutes: number;
  max_capacity: number;
  /** Base price in USD — used for the discount preview. */
  price: number;
}

/** A location option for the dropdown. */
export interface LocationOption {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
}

/** An instructor option for the dropdown (manager/super admin only). */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface CreateSessionClientProps {
  classTypes: ClassTypeOption[];
  locations: LocationOption[];
  /** Non-empty only for manager and super admin roles. */
  instructors: InstructorOption[];
  /** Whether the viewing user is an instructor (hides instructor selector). */
  isInstructor: boolean;
  /**
   * Full name of the currently logged-in user. Only provided when isInstructor
   * is true — displayed in a read-only row in place of the instructor selector.
   */
  instructorName?: string;
}

/** Form state shape for the create-session form. */
interface SessionForm {
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  /** Local date as YYYY-MM-DD */
  date: string;
  /** Local start time as HH:MM (24-hour) */
  start_time: string;
  /** Duration in minutes — auto-filled from class type, editable */
  duration_minutes: string;
  /** Max students — auto-filled from class type, editable */
  max_capacity: string;
  /** Promotional discount as a percentage string (0–50). Empty = no discount. */
  discount_percent: string;
  notes: string;
}

const EMPTY_FORM: SessionForm = {
  class_type_id: "",
  instructor_id: "",
  location_id: "",
  date: "",
  start_time: "",
  duration_minutes: "",
  max_capacity: "",
  discount_percent: "",
  notes: "",
};

/**
 * Converts a local date string and time string into a UTC ISO timestamp.
 * Relies on the browser's local timezone, which is appropriate since staff
 * are always in the same timezone as the classes they schedule.
 * @param date - YYYY-MM-DD
 * @param time - HH:MM (24-hour)
 * @returns ISO 8601 string in UTC.
 */
function toISO(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Renders the create-session form.
 * Selecting a class type auto-fills duration and capacity (editable).
 * On submit, POSTs to /api/sessions and redirects to the new session detail.
 */
export default function CreateSessionClient({
  classTypes,
  locations,
  instructors,
  isInstructor,
  instructorName,
}: CreateSessionClientProps) {
  const router = useRouter();
  const [form, setForm] = useState<SessionForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Tracks whether duration and capacity were last populated by the class-type auto-fill. */
  const [autoFilled, setAutoFilled] = useState(false);
  /** Local copy of locations — updated when a new location is added inline so the dropdown refreshes without a page reload. */
  const [locationList, setLocationList] = useState<LocationOption[]>(locations);
  /** Controls whether the Add Location slide-out panel is visible. */
  const [showAddLocationPanel, setShowAddLocationPanel] = useState(false);

  /**
   * Updates a single form field by name.
   * @param field - The SessionForm key to update.
   * @param value - New string value for that field.
   */
  function setField(field: keyof SessionForm, value: string) {
    // If the user manually edits duration or capacity, clear the auto-filled indicator.
    if (field === "duration_minutes" || field === "max_capacity") setAutoFilled(false);
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * When the user picks a class type, auto-fill duration and capacity
   * from the selected type's defaults. Values remain editable.
   * @param id - The selected class_type_id.
   */
  function handleClassTypeChange(id: string) {
    const type = classTypes.find((t) => t.id === id);
    setForm((prev) => ({
      ...prev,
      class_type_id: id,
      duration_minutes: type ? String(type.duration_minutes) : prev.duration_minutes,
      max_capacity: type ? String(type.max_capacity) : prev.max_capacity,
    }));
    // Show the auto-filled hint below the duration and capacity fields.
    if (type) setAutoFilled(true);
  }

  /**
   * Validates the form, builds starts_at/ends_at timestamps, and POSTs to
   * /api/sessions. On success, navigates to the new session's detail page.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation before hitting the API
    if (!form.class_type_id) {
      setError("Please select a class type.");
      return;
    }
    if (!isInstructor && !form.instructor_id) {
      setError("Please select an instructor.");
      return;
    }
    if (!form.location_id) {
      setError("Please select a location.");
      return;
    }
    if (!form.date || !form.start_time) {
      setError("Please enter a date and start time.");
      return;
    }
    const durationMin = parseInt(form.duration_minutes, 10);
    if (!form.duration_minutes || isNaN(durationMin) || durationMin < 1) {
      setError("Please enter a valid duration.");
      return;
    }
    const capacity = parseInt(form.max_capacity, 10);
    if (!form.max_capacity || isNaN(capacity) || capacity < 1) {
      setError("Please enter a valid max capacity.");
      return;
    }

    const parsedDiscount = form.discount_percent === "" ? null : parseFloat(form.discount_percent);
    if (parsedDiscount !== null && (isNaN(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 50)) {
      setError("Discount must be between 0% and 50%.");
      return;
    }

    // Compute starts_at / ends_at as UTC ISO strings
    const starts_at = toISO(form.date, form.start_time);
    const endsDate = new Date(starts_at);
    endsDate.setMinutes(endsDate.getMinutes() + durationMin);
    const ends_at = endsDate.toISOString();

    setLoading(true);

    const payload: Record<string, unknown> = {
      class_type_id: form.class_type_id,
      location_id: form.location_id,
      starts_at,
      ends_at,
      max_capacity: capacity,
      discount_percent: parsedDiscount,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };

    // Instructors omit instructor_id — server resolves it from their own profile.
    if (!isInstructor) {
      payload.instructor_id = form.instructor_id;
    }

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: string }).error)
            : "Failed to create session. Please try again.";
        setError(msg);
        setLoading(false);
        return;
      }

      const newId =
        typeof data === "object" && data !== null && "id" in data
          ? String((data as { id: string }).id)
          : null;

      if (!newId) {
        setError("Session created but could not redirect. Check the sessions list.");
        setLoading(false);
        return;
      }

      // Navigate to the new session detail page
      router.push(`/admin/sessions/${newId}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────

  /**
   * True when the selected date + start time resolve to a moment in the past.
   * Used to show an amber warning banner — non-blocking so managers can still
   * create historical sessions intentionally.
   */
  const isPastSession =
    !!form.date &&
    !!form.start_time &&
    new Date(`${form.date}T${form.start_time}:00`) < new Date();

  // ── Discount price preview ─────────────────────────────────────────────────

  /** Base price of the currently selected class type. Null when no class type is selected. */
  const selectedClassTypePrice = classTypes.find((t) => t.id === form.class_type_id)?.price ?? null;

  /** Parsed discount percentage, or null when the field is empty or invalid. */
  const parsedDiscountPreview = (() => {
    if (!form.discount_percent) return null;
    const n = parseFloat(form.discount_percent);
    return isNaN(n) || n <= 0 || n > 50 ? null : n;
  })();

  /**
   * Human-readable duration hint derived from the duration_minutes field.
   * Examples: "30 min", "2 hrs", "1 hr 30 min". Returns null when the field is empty.
   */
  const durationHint = (() => {
    const mins = parseInt(form.duration_minutes, 10);
    if (!form.duration_minutes || isNaN(mins) || mins < 1) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} hr${h !== 1 ? "s" : ""}`;
    return `${h} hr${h !== 1 ? "s" : ""} ${m} min`;
  })();

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create New Class Session</h1>
          <p className="text-sm text-gray-500 mt-1">
            New sessions are submitted for approval before appearing on the public schedule.
          </p>
        </div>
        <Link
          href="/admin/sessions"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Back to sessions
        </Link>
      </div>

      {/* Bulk creation prompt */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600 flex items-center justify-between">
        <span>Scheduling multiple sessions at once?</span>
        <Link
          href="/admin/sessions/bulk"
          className="font-medium text-red-600 hover:text-red-700 transition-colors whitespace-nowrap ml-4"
        >
          Use the bulk creator →
        </Link>
      </div>

      {/* ── Form ── */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white border border-gray-200 rounded-xl p-6 space-y-5"
      >
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        {/* Past-date warning — informational only, does not block submission */}
        {isPastSession && (
          <div
            role="status"
            className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm"
          >
            This session is scheduled in the past — double-check the date and time before submitting.
          </div>
        )}

        {/* Class Type */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-class-type" className="text-sm font-medium text-gray-700">
            Class Type <span className="text-red-500">*</span>
          </label>
          <select
            id="cs-class-type"
            value={form.class_type_id}
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

        {/* Instructor — selector for managers; read-only display for instructors */}
        {!isInstructor ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-instructor" className="text-sm font-medium text-gray-700">
              Instructor <span className="text-red-500">*</span>
            </label>
            <select
              id="cs-instructor"
              value={form.instructor_id}
              onChange={(e) => setField("instructor_id", e.target.value)}
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
          /* Instructors always create sessions for themselves — confirm who that is. */
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
            <label htmlFor="cs-location" className="text-sm font-medium text-gray-700">
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
            id="cs-location"
            value={form.location_id}
            onChange={(e) => setField("location_id", e.target.value)}
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

        {/* Date + Start time — side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-date" className="text-sm font-medium text-gray-700">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              id="cs-date"
              type="date"
              value={form.date}
              onChange={(e) => setField("date", e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cs-start-time" className="text-sm font-medium text-gray-700">
              Start Time <span className="text-red-500">*</span>
            </label>
            <input
              id="cs-start-time"
              type="time"
              value={form.start_time}
              onChange={(e) => setField("start_time", e.target.value)}
              required
              className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Duration + Capacity — side by side */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-duration" className="text-sm font-medium text-gray-700">
                Duration (minutes) <span className="text-red-500">*</span>
              </label>
              <input
                id="cs-duration"
                type="number"
                min={1}
                value={form.duration_minutes}
                onChange={(e) => setField("duration_minutes", e.target.value)}
                required
                placeholder="e.g. 120"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              {/* Computed hours — helps staff verify the duration at a glance */}
              {durationHint && (
                <p className="text-xs text-gray-400">{durationHint}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="cs-capacity" className="text-sm font-medium text-gray-700">
                Max Capacity <span className="text-red-500">*</span>
              </label>
              <input
                id="cs-capacity"
                type="number"
                min={1}
                value={form.max_capacity}
                onChange={(e) => setField("max_capacity", e.target.value)}
                required
                placeholder="e.g. 20"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Auto-filled hint — clears when the user manually edits either field */}
          {autoFilled && (
            <p className="text-xs text-gray-400">
              Duration and capacity were auto-filled from the class type — edit if needed.
            </p>
          )}
        </div>

        {/* Discount (optional) */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Discount <span className="text-gray-400 font-normal">(optional, max 50%)</span>
            </label>
            {parsedDiscountPreview !== null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                {parsedDiscountPreview}% OFF
              </span>
            )}
          </div>

          {/* Quick-pick shortcut buttons */}
          <div className="flex gap-2">
            {([10, 20, 25, 50] as const).map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setField("discount_percent", String(pct))}
                className={[
                  "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                  form.discount_percent === String(pct)
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-gray-700 border-gray-300 hover:border-red-400 hover:text-red-600",
                ].join(" ")}
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Custom percentage input */}
          <div className="flex items-center gap-2">
            <input
              id="cs-discount"
              type="number"
              min={0}
              max={50}
              step={1}
              value={form.discount_percent}
              onChange={(e) => {
                const raw = e.target.value;
                // Allow clearing; clamp to 50 on blur, not on keystroke, so typing feels natural
                if (raw === "" || parseFloat(raw) <= 50) {
                  setField("discount_percent", raw);
                }
              }}
              onBlur={() => {
                const n = parseFloat(form.discount_percent);
                if (!isNaN(n) && n > 50) setField("discount_percent", "50");
              }}
              placeholder="Custom % (0 – 50)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
            <span className="text-sm text-gray-500 select-none">%</span>
            {form.discount_percent && (
              <button
                type="button"
                onClick={() => setField("discount_percent", "")}
                className="text-xs text-gray-400 hover:text-red-600 transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded"
              >
                Clear
              </button>
            )}
          </div>

          {/* Live price preview — only shown when a class type with a price is selected */}
          {selectedClassTypePrice !== null && parsedDiscountPreview !== null && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              Price per person:{" "}
              <span className="line-through text-gray-400 mr-1">
                {selectedClassTypePrice === 0
                  ? "Free"
                  : `$${selectedClassTypePrice.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
              </span>
              <span className="font-semibold">
                {selectedClassTypePrice === 0
                  ? "Free"
                  : `$${(selectedClassTypePrice * (1 - parsedDiscountPreview / 100)).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
              </span>
            </p>
          )}
        </div>

        {/* Notes (optional) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cs-notes" className="text-sm font-medium text-gray-700">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="cs-notes"
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Any additional details for this session…"
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
          />
          {/* Character counter — appears once the user starts typing */}
          {form.notes.length > 0 && (
            <p className="text-xs text-gray-400 text-right">{form.notes.length}/500</p>
          )}
        </div>

        {/* Submit + Cancel */}
        <div className="pt-2 flex flex-col gap-3">
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {loading ? "Creating session…" : "Submit for Approval"}
          </button>
          <Link
            href="/admin/sessions"
            className="block text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Add Location slide-out panel — rendered outside the form to avoid nested form issues */}
      {showAddLocationPanel && (
        <AddLocationPanel
          onClose={() => setShowAddLocationPanel(false)}
          onAdded={(location: NewLocationResult) => {
            // Add to dropdown list (sorted) and auto-select the new location.
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
            setField("location_id", location.id);
          }}
        />
      )}
    </div>
  );
}

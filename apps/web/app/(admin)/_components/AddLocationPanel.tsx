"use client";

/**
 * AddLocationPanel — slide-out panel for creating a new location.
 * Reusable across admin pages that need inline location creation.
 * Used by: LocationsClient (admin/locations), CreateSessionClient (admin/sessions/new).
 *
 * Posts to POST /api/locations on submit. Calls onAdded with the new location
 * data so the consuming component can update its own list without a page refresh.
 * Shows a brief success message then calls onClose automatically.
 */

import { useState } from "react";
import { X } from "lucide-react";
import LocationFormFields, {
  blankLocationForm,
  validateLocationForm,
  type LocationFormState,
} from "./LocationFormFields";

// ── Types ──────────────────────────────────────────────────────────────────────

/** The location record returned by POST /api/locations on success. */
export interface NewLocationResult {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string | null;
  is_home_base: boolean;
  created_at: string;
}

interface AddLocationPanelProps {
  /** Called when the panel should close (X button, backdrop click, or Cancel). */
  onClose: () => void;
  /**
   * Called with the newly created location after a successful save.
   * The consuming component should add it to its own list and optionally
   * auto-select it.
   */
  onAdded: (location: NewLocationResult) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * Renders a fixed slide-out panel (with a dimmed backdrop) containing the
 * location creation form. Manages its own form state and submission.
 * @param onClose - Handler to close the panel.
 * @param onAdded - Handler called with the new location on success.
 */
export default function AddLocationPanel({ onClose, onAdded }: AddLocationPanelProps) {
  const [form, setForm] = useState<LocationFormState>(blankLocationForm());
  const [errors, setErrors] = useState<Partial<Record<keyof LocationFormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /**
   * Updates a single form field and clears its validation error.
   * @param field - The field to update.
   * @param value - New value for the field.
   */
  function handleChange(field: keyof LocationFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  /**
   * Validates and submits the form via POST /api/locations.
   * On success, calls onAdded with the new location, shows a brief confirmation
   * message, then calls onClose.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateLocationForm(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state,
          zip: form.zip.trim(),
          notes: form.notes.trim() || null,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        location?: NewLocationResult;
        error?: string;
      };

      if (!json.success || !json.location) {
        setError(json.error ?? "Failed to add location.");
        return;
      }

      onAdded(json.location);
      setSuccess(true);
      // Brief success flash then close.
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Dimmed backdrop — click to close */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label="Add location"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Add Location</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-md p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form body */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          <LocationFormFields
            form={form}
            errors={errors}
            onChange={handleChange}
            idPrefix="add-loc-panel"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && (
            <p className="text-sm font-medium text-green-600">Location added.</p>
          )}

          <div className="mt-auto flex gap-2 border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add Location"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

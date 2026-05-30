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

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Search, Loader2 } from "lucide-react";
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

/** A single address suggestion returned by the autocomplete proxy. */
interface PlaceSuggestion {
  place_id: string;
  description: string;
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

  // ── Address search state ──────────────────────────────────────────────────────
  /** What the user has typed into the address search box. */
  const [searchQuery, setSearchQuery] = useState("");
  /** Autocomplete suggestions from the server proxy. */
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  /** True while the autocomplete or details fetch is in flight. */
  const [searchLoading, setSearchLoading] = useState(false);
  /** Non-null when the autocomplete call returns a non-fatal error. */
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Controls suggestion dropdown visibility. */
  const [showSuggestions, setShowSuggestions] = useState(false);
  /** Ref for the search container — used to close suggestions on outside click. */
  const searchRef = useRef<HTMLDivElement>(null);

  // Close the suggestions dropdown when the user clicks outside the search box.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounce autocomplete calls while the user types (300ms delay).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as {
          success: boolean;
          suggestions?: PlaceSuggestion[];
          error?: string;
        };
        if (json.success && json.suggestions) {
          setSuggestions(json.suggestions);
          setShowSuggestions(json.suggestions.length > 0);
        } else {
          // Show the error subtly — user can still fill the form manually.
          setSearchError(json.error ?? null);
          setSuggestions([]);
        }
      } catch {
        // Silent fail — user can fill the address form below manually.
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  /**
   * Called when a suggestion is selected from the dropdown.
   * Fetches full address details from the server and populates the form fields.
   * @param suggestion - The selected autocomplete suggestion.
   */
  const handleSelectSuggestion = useCallback(async (suggestion: PlaceSuggestion) => {
    setSearchQuery(suggestion.description);
    setShowSuggestions(false);
    setSearchLoading(true);

    try {
      const res = await fetch(
        `/api/places/details?place_id=${encodeURIComponent(suggestion.place_id)}`
      );
      const json = (await res.json()) as {
        success: boolean;
        parsed?: { address: string; city: string; state: string; zip: string };
        error?: string;
      };

      if (json.success && json.parsed) {
        const { address, city, state, zip } = json.parsed;
        setForm((prev) => ({ ...prev, address, city, state, zip }));
        // Clear errors on the fields we just auto-populated.
        setErrors((prev) => ({
          ...prev,
          address: undefined,
          city: undefined,
          state: undefined,
          zip: undefined,
        }));
      }
    } catch {
      // Silent fail — form fields remain editable so the user can correct manually.
    } finally {
      setSearchLoading(false);
    }
  }, []);

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
          {/* Address search — type to find a real address and auto-fill the fields below */}
          <div ref={searchRef} className="relative">
            <label
              htmlFor="add-loc-search"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Search for an address
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id="add-loc-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Start typing an address…"
                autoComplete="off"
                className="w-full rounded-md border border-gray-300 py-1.5 pl-9 pr-9 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              {searchLoading && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
              )}
            </div>
            {searchError && (
              <p className="mt-0.5 text-xs text-amber-600">{searchError}</p>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
              >
                {suggestions.map((s) => (
                  <li key={s.place_id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => handleSelectSuggestion(s)}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-700 focus:bg-red-50 focus:outline-none"
                    >
                      {s.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Manual entry fields — auto-populated by the search above, editable */}
          <div className="border-t border-gray-100 pt-1">
            <p className="mb-3 text-xs text-gray-400">Or fill in the fields below manually:</p>
            <LocationFormFields
              form={form}
              errors={errors}
              onChange={handleChange}
              idPrefix="add-loc-panel"
            />
          </div>

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

"use client";

/**
 * LocationsClient — client component for the admin locations management page.
 * Handles the add panel, inline edit mode per card, home base toggle, and
 * inline delete confirmation. Used by: app/(admin)/admin/locations/page.tsx
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Loader2, MapPin, Plus, Search, Upload } from "lucide-react";
import LocationFormFields, {
  blankLocationForm,
  validateLocationForm,
  type LocationFormState,
} from "./LocationFormFields";
import AddLocationPanel, { type NewLocationResult } from "./AddLocationPanel";
import LocationImportPanel from "./LocationImportPanel";

// ── Types ──────────────────────────────────────────────────────────────────────

/** A locations row with a computed session count and last-used date. */
export interface LocationWithCount {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string | null;
  is_home_base: boolean;
  created_at: string;
  sessionCount: number;
  /** ISO timestamp of the most recent class session at this location, or null if never used. */
  last_used_at: string | null;
}

interface LocationsClientProps {
  initialLocations: LocationWithCount[];
  /** The viewing user's role — controls delete button visibility. */
  userRole?: string;
}

/** Two years in milliseconds — threshold for flagging a location as unused. */
const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

/**
 * True when a location has never hosted a session, or its last session is more
 * than two years old.
 *
 * `now` is passed in rather than read from `Date.now()` here so the check stays
 * pure — calling `Date.now()` during render returns a new value each pass, which
 * defeats memoization and trips the react-hooks/purity rule. The caller captures
 * a single timestamp at mount; a location cannot cross the two-year boundary
 * while someone is looking at the page.
 *
 * @param loc - The location to test.
 * @param now - Epoch milliseconds to measure staleness against.
 */
function isUnusedTwoYears(loc: LocationWithCount, now: number): boolean {
  return (
    loc.last_used_at === null ||
    now - new Date(loc.last_used_at).getTime() > TWO_YEARS_MS
  );
}

/** A single address suggestion returned by the autocomplete proxy. */
interface PlaceSuggestion {
  place_id: string;
  description: string;
}

/**
 * Sorts locations: home base first, then alphabetically by name.
 * @param locations - Candidate list to sort.
 */
function sortAndCapTopLocations(
  locations: LocationWithCount[]
): LocationWithCount[] {
  return [...locations].sort(
    (a, b) =>
      Number(b.is_home_base) - Number(a.is_home_base) ||
      a.name.localeCompare(b.name)
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Client component for managing locations. */
export default function LocationsClient({
  initialLocations,
  userRole,
}: LocationsClientProps) {
  const [topLocations, setTopLocations] = useState<LocationWithCount[]>(
    sortAndCapTopLocations(initialLocations)
  );
  // Search results carry the query that produced them. Render compares that tag
  // against the query currently typed to derive both whether the results are
  // current and whether a fetch is still pending, so neither has to be synced
  // from inside the effect below.
  const [searchResults, setSearchResults] = useState<{
    query: string;
    locations: LocationWithCount[];
  }>({ query: "", locations: [] });
  const [searchQuery, setSearchQuery] = useState("");
  const [showUnused, setShowUnused] = useState(false);
  // Timestamp captured once at mount and reused for every staleness check below.
  // See isUnusedTwoYears for why this is not read from Date.now() during render.
  const [nowMs] = useState(() => Date.now());

  const trimmedQuery = searchQuery.trim();
  const isSearchMode = trimmedQuery.length > 0;
  // Results still tagged with an older query mean the debounce or fetch for the
  // current one has not landed yet.
  const searchLoading = isSearchMode && searchResults.query !== trimmedQuery;

  useEffect(() => {
    if (!trimmedQuery) return;

    // Guards against a slow response for an abandoned query overwriting the
    // results of a newer one.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/locations?q=${encodeURIComponent(trimmedQuery)}`
        );
        const json = (await res.json()) as {
          success: boolean;
          locations?: LocationWithCount[];
        };
        if (!cancelled && json.success && json.locations) {
          setSearchResults({ query: trimmedQuery, locations: json.locations });
        }
      } catch {
        // Silent fail — the spinner stays up rather than showing stale hits
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LocationFormState>(blankLocationForm());
  const [editErrors, setEditErrors] = useState<
    Partial<Record<keyof LocationFormState, string>>
  >({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [homeBaseLoading, setHomeBaseLoading] = useState<string | null>(null);
  const [homeBaseError, setHomeBaseError] = useState<string | null>(null);

  // ── Edit address autocomplete state ────────────────────────────────────────
  const [editSearchQuery, setEditSearchQuery] = useState("");
  // Suggestions carry the query that produced them; render discards them once
  // the query moves on, so the effect never has to clear them synchronously.
  const [editSuggestions, setEditSuggestions] = useState<{
    query: string;
    items: PlaceSuggestion[];
  }>({ query: "", items: [] });
  const [editSearchLoading, setEditSearchLoading] = useState(false);
  const [editSearchError, setEditSearchError] = useState<string | null>(null);
  const [editShowSuggestions, setEditShowSuggestions] = useState(false);
  /** Ref for the search container — used to close dropdown on outside click. */
  const editSearchRef = useRef<HTMLDivElement>(null);

  // Close the suggestions dropdown when the user clicks outside the search box.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (editSearchRef.current && !editSearchRef.current.contains(e.target as Node)) {
        setEditShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const trimmedEditQuery = editSearchQuery.trim();
  // Only suggestions fetched for the query currently typed are eligible to show.
  // A short query yields an empty list, which collapses the dropdown on its own.
  const visibleEditSuggestions =
    trimmedEditQuery.length >= 3 && editSuggestions.query === trimmedEditQuery
      ? editSuggestions.items
      : [];

  // Debounce autocomplete calls while the user types in the edit search box.
  useEffect(() => {
    if (trimmedEditQuery.length < 3) return;

    // Guards against a slow response for an abandoned query landing late.
    let cancelled = false;
    const timer = setTimeout(async () => {
      setEditSearchLoading(true);
      setEditSearchError(null);
      try {
        const res = await fetch(
          `/api/places/autocomplete?q=${encodeURIComponent(trimmedEditQuery)}`
        );
        const json = (await res.json()) as {
          success: boolean;
          suggestions?: PlaceSuggestion[];
          error?: string;
        };
        if (cancelled) return;
        if (json.success && json.suggestions) {
          setEditSuggestions({
            query: trimmedEditQuery,
            items: json.suggestions,
          });
          setEditShowSuggestions(json.suggestions.length > 0);
        } else {
          setEditSearchError(json.error ?? null);
          setEditSuggestions({ query: trimmedEditQuery, items: [] });
        }
      } catch {
        if (!cancelled) {
          setEditSuggestions({ query: trimmedEditQuery, items: [] });
        }
      } finally {
        if (!cancelled) setEditSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedEditQuery]);

  /**
   * Called when a suggestion is selected from the edit-mode dropdown.
   * Fetches full address details and populates the edit form fields.
   * @param suggestion - The selected autocomplete suggestion.
   */
  const handleEditSelectSuggestion = useCallback(async (suggestion: PlaceSuggestion) => {
    setEditSearchQuery(suggestion.description);
    setEditShowSuggestions(false);
    setEditSearchLoading(true);
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
        setEditForm((prev) => ({ ...prev, address, city, state, zip }));
        setEditErrors((prev) => ({
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
      setEditSearchLoading(false);
    }
  }, []);

  /**
   * Adds a newly created location to the top list.
   * Called by AddLocationPanel after a successful save.
   * @param location - The new location returned by POST /api/locations.
   */
  function handleLocationAdded(location: NewLocationResult) {
    setTopLocations((prev) =>
      sortAndCapTopLocations([...prev, { ...location, sessionCount: 0, last_used_at: null }])
    );
  }

  /**
   * Called by LocationImportPanel after a successful CSV import.
   * Reloads the top-10 list from the server so newly imported locations appear.
   * @param _count - Number of locations created (unused here — we just refetch).
   */
  async function handleImported(_count: number) {
    setShowImportPanel(false);
    // Trigger a full page reload so the server re-fetches the updated list.
    // This matches how ClassTypePanel works after a save (router.refresh).
    window.location.reload();
  }

  /**
   * Opens inline edit mode for a location card.
   * @param loc - The location to edit.
   */
  function startEdit(loc: LocationWithCount) {
    setEditingId(loc.id);
    setEditForm({
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      notes: loc.notes ?? "",
    });
    setEditErrors({});
    setEditError(null);
    // Reset autocomplete search for this new edit session
    setEditSearchQuery("");
    setEditSuggestions({ query: "", items: [] });
    setEditShowSuggestions(false);
    setEditSearchError(null);
    if (deletingId === loc.id) setDeletingId(null);
  }

  /** Cancels inline edit mode without saving. */
  function cancelEdit() {
    setEditingId(null);
    setEditErrors({});
    setEditError(null);
    setEditSearchQuery("");
    setEditSuggestions({ query: "", items: [] });
    setEditShowSuggestions(false);
    setEditSearchError(null);
  }

  /**
   * Updates a single field in the edit form.
   * @param field - The field name to update.
   * @param value - The new value.
   */
  function handleEditChange(field: keyof LocationFormState, value: string) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setEditErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  /**
   * Saves edits via PATCH /api/locations/[id].
   * @param id - The location ID being edited.
   */
  async function handleEditSave(id: string) {
    const errs = validateLocationForm(editForm);
    if (Object.keys(errs).length > 0) {
      setEditErrors(errs);
      return;
    }

    setEditSaving(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          address: editForm.address.trim(),
          city: editForm.city.trim(),
          state: editForm.state,
          zip: editForm.zip.trim(),
          notes: editForm.notes.trim() || null,
        }),
      });

      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setEditError(json.error ?? "Failed to save changes.");
        return;
      }

      const applyEdit = (prev: LocationWithCount[]) =>
        prev
          .map((l) =>
            l.id === id
              ? {
                  ...l,
                  name: editForm.name.trim(),
                  address: editForm.address.trim(),
                  city: editForm.city.trim(),
                  state: editForm.state,
                  zip: editForm.zip.trim(),
                  notes: editForm.notes.trim() || null,
                }
              : l
          )
          .sort(
            (a, b) =>
              Number(b.is_home_base) - Number(a.is_home_base) ||
              a.name.localeCompare(b.name)
          );

      setTopLocations((prev) => sortAndCapTopLocations(applyEdit(prev)));
      setSearchResults((prev) => ({ ...prev, locations: applyEdit(prev.locations) }));
      setEditingId(null);
    } catch {
      setEditError("Network error. Please try again.");
    } finally {
      setEditSaving(false);
    }
  }

  /**
   * Sets a location as the home base via PATCH /api/locations/[id]/set-home-base.
   * @param id - The location ID to promote to home base.
   */
  const handleSetHomeBase = useCallback(async (id: string) => {
    setHomeBaseLoading(id);
    setHomeBaseError(null);

    try {
      const res = await fetch(`/api/locations/${id}/set-home-base`, {
        method: "PATCH",
      });

      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setHomeBaseError(json.error ?? "Failed to update home base.");
        return;
      }

      const applyHomeBase = (prev: LocationWithCount[]) =>
        prev
          .map((l) => ({ ...l, is_home_base: l.id === id }))
          .sort(
            (a, b) =>
              Number(b.is_home_base) - Number(a.is_home_base) ||
              a.name.localeCompare(b.name)
          );

      setTopLocations((prev) => sortAndCapTopLocations(applyHomeBase(prev)));
      setSearchResults((prev) => ({
        ...prev,
        locations: applyHomeBase(prev.locations),
      }));
    } catch {
      setHomeBaseError("Network error. Please try again.");
    } finally {
      setHomeBaseLoading(null);
    }
  }, []);

  /**
   * Deletes a location via DELETE /api/locations/[id].
   * @param id - The location ID to delete.
   */
  async function handleDelete(id: string) {
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };

      if (!json.success) {
        setDeleteError(json.error ?? "Failed to delete location.");
        return;
      }

      setTopLocations((prev) => prev.filter((l) => l.id !== id));
      setSearchResults((prev) => ({
        ...prev,
        locations: prev.locations.filter((l) => l.id !== id),
      }));
      setDeletingId(null);
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  }

  const isSuperAdmin = userRole === "super_admin";

  // Apply unused filter on top of search/top-10 results
  const rawDisplayed = isSearchMode ? searchResults.locations : topLocations;
  const displayedLocations = showUnused
    ? rawDisplayed.filter((loc) => isUnusedTwoYears(loc, nowMs))
    : rawDisplayed;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportPanel(true)}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => setShowAddPanel(true)}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
          <Plus className="h-4 w-4" />
          Add Location
          </button>
        </div>
      </div>

      {topLocations.length > 0 && (
        <div className="relative mb-6 flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Search locations…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
          {/* Toggle button: show only locations unused for 2+ years */}
          <button
            type="button"
            onClick={() => setShowUnused((v) => !v)}
            className={`shrink-0 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
              showUnused
                ? "border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
            aria-pressed={showUnused}
          >
            {showUnused ? "Showing unused only" : "Show unused"}
          </button>
        </div>
      )}

      {homeBaseError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {homeBaseError}
        </div>
      )}

      {topLocations.length === 0 && !isSearchMode ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-20 text-center">
          <MapPin className="mb-3 h-10 w-10 text-gray-300" />
          <p className="mb-4 text-sm text-gray-500">No locations saved yet.</p>
          <button
            type="button"
            onClick={() => setShowAddPanel(true)}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Add your first location
          </button>
        </div>
      ) : searchLoading ? (
        <p className="text-sm text-gray-500">Searching…</p>
      ) : isSearchMode && displayedLocations.length === 0 ? (
        <p className="text-sm text-gray-500">
          No locations match &ldquo;{searchQuery}&rdquo;{showUnused ? " (unused filter active)" : ""}.
        </p>
      ) : showUnused && displayedLocations.length === 0 ? (
        <p className="text-sm text-gray-500">
          No unused locations found — all locations have been used within the last 2 years.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {displayedLocations.map((loc) => {
            const isEditing = editingId === loc.id;
            const isConfirmingDelete = deletingId === loc.id;

            return (
              <div
                key={loc.id}
                className={`rounded-lg border bg-white p-5 shadow-sm ${
                  isUnusedTwoYears(loc, nowMs)
                    ? "border-amber-300"
                    : "border-gray-200"
                }`}
              >
                {isEditing ? (
                  <div>
                    <p className="mb-3 text-sm font-semibold text-gray-700">
                      Edit Location
                    </p>

                    {/* Address autocomplete search — same behaviour as Add Location panel */}
                    <div ref={editSearchRef} className="relative mb-3">
                      <label
                        htmlFor={`edit-search-${loc.id}`}
                        className="mb-1 block text-xs font-medium text-gray-700"
                      >
                        Search for an address
                      </label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                          id={`edit-search-${loc.id}`}
                          type="text"
                          value={editSearchQuery}
                          onChange={(e) => setEditSearchQuery(e.target.value)}
                          onFocus={() =>
                            visibleEditSuggestions.length > 0 &&
                            setEditShowSuggestions(true)
                          }
                          placeholder="Start typing an address…"
                          autoComplete="off"
                          className="w-full rounded-md border border-gray-300 py-1.5 pl-9 pr-9 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                        {editSearchLoading && (
                          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                        )}
                      </div>
                      {editSearchError && (
                        <p className="mt-0.5 text-xs text-amber-600">{editSearchError}</p>
                      )}
                      {editShowSuggestions && visibleEditSuggestions.length > 0 && (
                        <ul
                          role="listbox"
                          className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
                        >
                          {visibleEditSuggestions.map((s) => (
                            <li key={s.place_id} role="option" aria-selected={false}>
                              <button
                                type="button"
                                onClick={() => handleEditSelectSuggestion(s)}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-700 focus:bg-red-50 focus:outline-none"
                              >
                                {s.description}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="mb-3 border-t border-gray-100 pt-3">
                      <p className="mb-2 text-xs text-gray-400">Or fill in the fields below manually:</p>
                      <LocationFormFields
                        form={editForm}
                        errors={editErrors}
                        onChange={handleEditChange}
                        idPrefix={`edit-${loc.id}`}
                      />
                    </div>
                    {editError && (
                      <p className="mt-2 text-xs text-red-600">{editError}</p>
                    )}
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditSave(loc.id)}
                        disabled={editSaving}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={editSaving}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h2 className="font-semibold text-gray-900">{loc.name}</h2>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {loc.is_home_base && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                            Home Base
                          </span>
                        )}
                        {isUnusedTwoYears(loc, nowMs) && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                            Unused 2y+
                          </span>
                        )}
                      </div>
                    </div>

                    <address className="not-italic text-sm text-gray-600">
                      {loc.address}
                      <br />
                      {loc.city}, {loc.state} {loc.zip}
                    </address>

                    {loc.notes && (
                      <p className="mt-1.5 text-xs text-gray-500">{loc.notes}</p>
                    )}

                    <p className="mt-2 text-xs text-gray-400">
                      Used in {loc.sessionCount}{" "}
                      {loc.sessionCount !== 1 ? "sessions" : "session"}
                      {loc.last_used_at
                        ? ` · Last used ${
                            new Date(loc.last_used_at).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                            })
                          }`
                        : " · Never used"}
                    </p>

                    {isConfirmingDelete && (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                        <p className="mb-1 text-sm font-medium text-red-700">
                          Delete &ldquo;{loc.name}&rdquo;?
                        </p>
                        {loc.sessionCount > 0 && (
                          <p className="mb-2 text-xs text-red-600">
                            This location is linked to {loc.sessionCount}{" "}
                            {loc.sessionCount !== 1 ? "sessions" : "session"}.
                            It cannot be deleted while sessions reference it.
                          </p>
                        )}
                        {deleteError && (
                          <p className="mb-1 text-xs text-red-600">
                            {deleteError}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(loc.id)}
                            disabled={deleteLoading}
                            className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deleteLoading ? "Deleting…" : "Delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingId(null);
                              setDeleteError(null);
                            }}
                            disabled={deleteLoading}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {!isConfirmingDelete && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(loc)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                        >
                          Edit
                        </button>

                        {loc.is_home_base ? (
                          <span className="text-xs text-gray-400">
                            Current home base
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Set ${loc.name} as home base`}
                            onClick={() => handleSetHomeBase(loc.id)}
                            disabled={homeBaseLoading === loc.id}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {homeBaseLoading === loc.id
                              ? "Updating…"
                              : "Set as Home Base"}
                          </button>
                        )}

                        {loc.sessionCount === 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingId(loc.id);
                              setDeleteError(null);
                            }}
                            className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        ) : isSuperAdmin ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingId(loc.id);
                              setDeleteError(null);
                            }}
                            className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddPanel && (
        <AddLocationPanel
          onClose={() => setShowAddPanel(false)}
          onAdded={handleLocationAdded}
        />
      )}

      {showImportPanel && (
        <LocationImportPanel
          onClose={() => setShowImportPanel(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}

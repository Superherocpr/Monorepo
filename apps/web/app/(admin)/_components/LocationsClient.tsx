"use client";

/**
 * LocationsClient — client component for the admin locations management page.
 * Handles the add panel, inline edit mode per card, home base toggle, and
 * inline delete confirmation. Used by: app/(admin)/admin/locations/page.tsx
 */

import { useState, useCallback, useEffect } from "react";
import { MapPin, Plus, Search, X } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

/** A locations row with a computed session count. */
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
}

/** Fields used for both add and edit forms. */
interface LocationFormState {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
}

interface LocationsClientProps {
  initialLocations: LocationWithCount[];
}

// ── US state options ───────────────────────────────────────────────────────────
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

/** Returns a blank form state. */
function blankForm(): LocationFormState {
  return { name: "", address: "", city: "", state: "", zip: "", notes: "" };
}

/** Validates a location form. Returns a map of field → error message. */
function validateForm(
  f: LocationFormState
): Partial<Record<keyof LocationFormState, string>> {
  const errors: Partial<Record<keyof LocationFormState, string>> = {};
  if (!f.name.trim()) errors.name = "Name is required.";
  if (!f.address.trim()) errors.address = "Address is required.";
  if (!f.city.trim()) errors.city = "City is required.";
  if (!f.state) errors.state = "State is required.";
  if (!f.zip.trim()) errors.zip = "Zip code is required.";
  return errors;
}

/**
 * Sorts locations for the top list and enforces a hard cap of 10 rows.
 * @param locations - Candidate list to sort and trim.
 */
function sortAndCapTopLocations(
  locations: LocationWithCount[]
): LocationWithCount[] {
  return [...locations]
    .sort(
      (a, b) =>
        Number(b.is_home_base) - Number(a.is_home_base) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 10);
}

// ── Sub-component: location form fields ────────────────────────────────────────

/**
 * Reusable set of form fields used in both the add panel and inline edit mode.
 * @param form - Current form values.
 * @param errors - Validation error messages keyed by field name.
 * @param onChange - Called when any field changes; receives field name and new value.
 * @param idPrefix - Prefix for label htmlFor / input id to avoid ID collisions.
 */
function LocationFormFields({
  form,
  errors,
  onChange,
  idPrefix,
}: {
  form: LocationFormState;
  errors: Partial<Record<keyof LocationFormState, string>>;
  onChange: (field: keyof LocationFormState, value: string) => void;
  idPrefix: string;
}) {
  const field = (
    name: keyof LocationFormState,
    label: string,
    required = true
  ) => (
    <div>
      <label
        htmlFor={`${idPrefix}-${name}`}
        className="mb-1 block text-xs font-medium text-gray-700"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={`${idPrefix}-${name}`}
        type="text"
        value={form[name]}
        onChange={(e) => onChange(name, e.target.value)}
        className={`w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 ${
          errors[name]
            ? "border-red-400 focus:border-red-400"
            : "border-gray-300 focus:border-red-500"
        }`}
      />
      {errors[name] && (
        <p className="mt-0.5 text-xs text-red-600">{errors[name]}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {field("name", "Location Name")}
      {field("address", "Street Address")}
      <div className="grid grid-cols-3 gap-3">
        {field("city", "City")}
        <div>
          <label
            htmlFor={`${idPrefix}-state`}
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            State<span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            id={`${idPrefix}-state`}
            value={form.state}
            onChange={(e) => onChange("state", e.target.value)}
            className={`w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 ${
              errors.state
                ? "border-red-400 focus:border-red-400"
                : "border-gray-300 focus:border-red-500"
            }`}
          >
            <option value="">—</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {errors.state && (
            <p className="mt-0.5 text-xs text-red-600">{errors.state}</p>
          )}
        </div>
        {field("zip", "Zip")}
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-notes`}
          className="mb-1 block text-xs font-medium text-gray-700"
        >
          Notes
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          value={form.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Client component for managing locations. */
export default function LocationsClient({
  initialLocations,
}: LocationsClientProps) {
  const [topLocations, setTopLocations] = useState<LocationWithCount[]>(
    sortAndCapTopLocations(initialLocations)
  );
  const [searchResults, setSearchResults] = useState<LocationWithCount[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/locations?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as {
          success: boolean;
          locations?: LocationWithCount[];
        };
        if (json.success && json.locations) {
          setSearchResults(json.locations);
        }
      } catch {
        // Silent fail — keep previous results visible
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addForm, setAddForm] = useState<LocationFormState>(blankForm());
  const [addErrors, setAddErrors] = useState<
    Partial<Record<keyof LocationFormState, string>>
  >({});
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LocationFormState>(blankForm());
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

  /**
   * Updates a single field in the add form.
   * @param field - The field name to update.
   * @param value - The new value.
   */
  function handleAddChange(field: keyof LocationFormState, value: string) {
    setAddForm((prev) => ({ ...prev, [field]: value }));
    setAddErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  /**
   * Submits the add form. Creates a new location via POST /api/locations.
   * @param e - Form submit event.
   */
  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateForm(addForm);
    if (Object.keys(errs).length > 0) {
      setAddErrors(errs);
      return;
    }

    setAddSaving(true);
    setAddError(null);

    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          address: addForm.address.trim(),
          city: addForm.city.trim(),
          state: addForm.state,
          zip: addForm.zip.trim(),
          notes: addForm.notes.trim() || null,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        location?: LocationWithCount;
        error?: string;
      };

      if (!json.success || !json.location) {
        setAddError(json.error ?? "Failed to add location.");
        return;
      }

      setTopLocations((prev) =>
        sortAndCapTopLocations([...prev, { ...json.location!, sessionCount: 0 }])
      );
      setAddSuccess(true);
      setAddForm(blankForm());
      setTimeout(() => {
        setShowAddPanel(false);
        setAddSuccess(false);
      }, 1200);
    } catch {
      setAddError("Network error. Please try again.");
    } finally {
      setAddSaving(false);
    }
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
    if (deletingId === loc.id) setDeletingId(null);
  }

  /** Cancels inline edit mode without saving. */
  function cancelEdit() {
    setEditingId(null);
    setEditErrors({});
    setEditError(null);
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
    const errs = validateForm(editForm);
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
      setSearchResults(applyEdit);
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
      setSearchResults(applyHomeBase);
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
      setSearchResults((prev) => prev.filter((l) => l.id !== id));
      setDeletingId(null);
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  }

  const isSearchMode = searchQuery.trim().length > 0;
  const displayedLocations = isSearchMode ? searchResults : topLocations;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
        <button
          type="button"
          onClick={() => {
            setAddForm(blankForm());
            setAddErrors({});
            setAddError(null);
            setAddSuccess(false);
            setShowAddPanel(true);
          }}
          className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          <Plus className="h-4 w-4" />
          Add Location
        </button>
      </div>

      {topLocations.length > 0 && (
        <div className="relative mb-6 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search locations…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
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
          No locations match &ldquo;{searchQuery}&rdquo;.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {displayedLocations.map((loc) => {
            const isEditing = editingId === loc.id;
            const isConfirmingDelete = deletingId === loc.id;

            return (
              <div
                key={loc.id}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
              >
                {isEditing ? (
                  <div>
                    <p className="mb-3 text-sm font-semibold text-gray-700">
                      Edit Location
                    </p>
                    <LocationFormFields
                      form={editForm}
                      errors={editErrors}
                      onChange={handleEditChange}
                      idPrefix={`edit-${loc.id}`}
                    />
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
                      {loc.is_home_base && (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          Home Base
                        </span>
                      )}
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
                    </p>

                    {isConfirmingDelete && (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                        <p className="mb-2 text-sm font-medium text-red-700">
                          Delete &ldquo;{loc.name}&rdquo;?
                        </p>
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

                        {loc.sessionCount === 0 && (
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
                        )}
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
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setShowAddPanel(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                Add Location
              </h2>
              <button
                type="button"
                onClick={() => setShowAddPanel(false)}
                aria-label="Close panel"
                className="rounded-md p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleAddSubmit}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
            >
              <LocationFormFields
                form={addForm}
                errors={addErrors}
                onChange={handleAddChange}
                idPrefix="add"
              />

              {addError && (
                <p className="text-sm text-red-600">{addError}</p>
              )}
              {addSuccess && (
                <p className="text-sm font-medium text-green-600">
                  Location added.
                </p>
              )}

              <div className="mt-auto flex gap-2 border-t border-gray-200 pt-4">
                <button
                  type="submit"
                  disabled={addSaving}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {addSaving ? "Adding…" : "Add Location"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddPanel(false)}
                  disabled={addSaving}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}

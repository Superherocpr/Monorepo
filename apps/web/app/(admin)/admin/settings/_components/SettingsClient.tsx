"use client";

/**
 * SettingsClient component
 * Full client component owning all state and mutations for the settings page.
 * Sections: Appearance (dark mode), Class Types, Preset Grades, Zoho Mail,
 *           Instructor Payment Routing.
 * Used by: /admin/settings/page.tsx
 */

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, AlertCircle } from "lucide-react";
import ClassTypePanel from "./ClassTypePanel";
import type { ClassType, PresetGrade, InstructorRoutingRow } from "../page";

interface SettingsClientProps {
  classTypes: ClassType[];
  presetGrades: PresetGrade[];
  instructors: InstructorRoutingRow[];
  zohoConnected: boolean;
  zohoEmail: string | null;
  /** Value of the ?zoho= query param — "connected" | "error" | null */
  zohoParam: string | null;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

/** Input styles shared across all settings inputs. */
const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent dark:bg-gray-800 dark:border-gray-600 dark:text-white";

/** A new inline preset-grade row being drafted by the user. */
interface DraftGrade {
  value: string;
  label: string;
}

/** An existing preset grade being edited inline. */
interface EditingGrade {
  id: string;
  value: string;
  label: string;
}

/**
 * Root settings client component. Owns all section state.
 * @param classTypes - All class types fetched server-side.
 * @param presetGrades - All preset grades fetched server-side, ordered by value.
 * @param zohoConnected - Whether a Zoho account is currently linked.
 * @param zohoEmail - The Zoho account email if connected.
 * @param zohoParam - The ?zoho= query param from OAuth redirects.
 */
const SettingsClient: React.FC<SettingsClientProps> = ({
  classTypes: initialClassTypes,
  presetGrades: initialPresetGrades,
  instructors: initialInstructors,
  zohoConnected: initialZohoConnected,
  zohoEmail,
  zohoParam,
}) => {
  const router = useRouter();

  // ── Dark mode ──────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = stored === "dark";
    setIsDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);

  /**
   * Toggles dark mode on/off. Writes to localStorage and updates the document class.
   * TODO: apply dark: variants to admin layout and components.
   */
  function toggleDarkMode() {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  // ── Class types ────────────────────────────────────────────────────────────
  const [classTypes, setClassTypes] = useState<ClassType[]>(initialClassTypes);
  const [classTypePanelOpen, setClassTypePanelOpen] = useState(false);
  const [editingClassType, setEditingClassType] = useState<ClassType | null>(null);
  const [togglingClassTypeId, setTogglingClassTypeId] = useState<string | null>(null);

  // ── Preset grades ──────────────────────────────────────────────────────────
  const [grades, setGrades] = useState<PresetGrade[]>(initialPresetGrades);
  const [editingGrade, setEditingGrade] = useState<EditingGrade | null>(null);
  const [draftGrade, setDraftGrade] = useState<DraftGrade | null>(null);
  const [savingGradeId, setSavingGradeId] = useState<string | null>(null);
  const [deletingGradeId, setDeletingGradeId] = useState<string | null>(null);
  const [addingGrade, setAddingGrade] = useState(false);
  const draftValueRef = useRef<HTMLInputElement>(null);

  // ── Zoho ───────────────────────────────────────────────────────────────────
  const [zohoConnected, setZohoConnected] = useState(initialZohoConnected);
  const [disconnectingZoho, setDisconnectingZoho] = useState(false);

  // ── Instructor payment routing ─────────────────────────────────────────────
  const [instructors, setInstructors] = useState<InstructorRoutingRow[]>(initialInstructors);
  // Tracks which instructor row's toggle is currently saving — disables that row's buttons
  const [savingRoutingId, setSavingRoutingId] = useState<string | null>(null);

  /**
   * Updates an instructor's payment_routing preference. Optimistically applies
   * the change, then rolls back on error.
   * @param instructorId - UUID of the instructor profile to update.
   * @param next - New routing value.
   */
  async function handleRoutingChange(
    instructorId: string,
    next: "instructor" | "business"
  ) {
    const previous = instructors.find((i) => i.id === instructorId)?.payment_routing;
    if (!previous || previous === next) return;

    setSavingRoutingId(instructorId);
    setInstructors((prev) =>
      prev.map((i) => (i.id === instructorId ? { ...i, payment_routing: next } : i))
    );

    try {
      const res = await fetch(`/api/settings/instructor-routing/${instructorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_routing: next }),
      });

      if (!res.ok) {
        // Roll back on failure
        setInstructors((prev) =>
          prev.map((i) =>
            i.id === instructorId ? { ...i, payment_routing: previous } : i
          )
        );
        showToast("error", "Failed to update payment routing.");
        return;
      }

      const updated = instructors.find((i) => i.id === instructorId);
      const name = updated ? `${updated.first_name} ${updated.last_name}` : "instructor";
      showToast("success", `Payment routing updated for ${name}.`);
    } catch {
      setInstructors((prev) =>
        prev.map((i) =>
          i.id === instructorId ? { ...i, payment_routing: previous } : i
        )
      );
      showToast("error", "Failed to update payment routing.");
    } finally {
      setSavingRoutingId(null);
    }
  }

  // ── Social feed refresh ───────────────────────────────────────────────────
  const [refreshingFeed, setRefreshingFeed] = useState(false);
  const [lastRefreshCount, setLastRefreshCount] = useState<number | null>(null);

  /**
   * Calls POST /api/social/refresh to pull the latest photo posts from
   * Facebook and populate the social_feed_cache table.
   * Side effects: updates social_feed_cache rows in the database.
   */
  async function handleRefreshFeed() {
    setRefreshingFeed(true);
    setLastRefreshCount(null);
    try {
      const res = await fetch("/api/social/refresh", { method: "POST" });
      const json = (await res.json()) as { upserted?: number; error?: string; message?: string };
      if (!res.ok) {
        showToast("error", json.error ?? "Failed to refresh social feed.");
        return;
      }
      setLastRefreshCount(json.upserted ?? 0);
      showToast(
        "success",
        json.upserted
          ? `Social feed updated — ${json.upserted} post${json.upserted !== 1 ? "s" : ""} cached.`
          : "No new photo posts found on the Facebook page."
      );
    } catch {
      showToast("error", "Failed to refresh social feed.");
    } finally {
      setRefreshingFeed(false);
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast | null>(null);

  // Show Zoho OAuth result banner on mount if ?zoho= param present
  useEffect(() => {
    if (zohoParam === "connected") {
      showToast("success", "Zoho Mail connected successfully.");
      setZohoConnected(true);
      // Clean the query param from the URL without a navigation
      window.history.replaceState({}, "", "/admin/settings");
    } else if (zohoParam === "error") {
      showToast("error", "Zoho connection failed. Please try again.");
      window.history.replaceState({}, "", "/admin/settings");
    }
  }, [zohoParam]);

  /**
   * Shows a toast notification. Success auto-dismisses after 4 seconds.
   * @param type - "success" or "error"
   * @param message - The message text.
   */
  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    if (type === "success") {
      setTimeout(() => setToast(null), 4000);
    }
  }

  // ── Class type actions ─────────────────────────────────────────────────────

  /**
   * Toggles the active state of a class type in one click.
   * Calls PATCH /api/settings/class-types/[id]/toggle-active.
   * @param ct - The class type to toggle.
   */
  async function handleToggleClassType(ct: ClassType) {
    setTogglingClassTypeId(ct.id);
    try {
      const res = await fetch(`/api/settings/class-types/${ct.id}/toggle-active`, {
        method: "PATCH",
      });
      const data: { success: boolean; active?: boolean; error?: string } =
        await res.json();
      if (!res.ok || !data.success) {
        showToast("error", data.error ?? "Failed to update class type.");
      } else {
        setClassTypes((prev) =>
          prev.map((c) => (c.id === ct.id ? { ...c, active: data.active! } : c))
        );
        showToast(
          "success",
          `"${ct.name}" ${data.active ? "activated" : "deactivated"}.`
        );
      }
    } catch {
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setTogglingClassTypeId(null);
    }
  }

  /**
   * Called by ClassTypePanel on a successful save (create or update).
   * Refreshes the list from the server to get the canonical data.
   * @param message - Success message to display in the toast.
   */
  function handleClassTypeSaved(message: string) {
    setClassTypePanelOpen(false);
    setEditingClassType(null);
    showToast("success", message);
    router.refresh();
  }

  // ── Preset grade actions ───────────────────────────────────────────────────

  /**
   * Saves an inline-edited preset grade via PATCH /api/settings/preset-grades/[id].
   * @param id - The grade's UUID.
   */
  async function handleSaveGrade(id: string) {
    if (!editingGrade || editingGrade.id !== id) return;

    const parsedValue = parseInt(editingGrade.value, 10);
    if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 100) {
      showToast("error", "Grade value must be a number between 0 and 100.");
      return;
    }
    if (!editingGrade.label.trim()) {
      showToast("error", "Label is required.");
      return;
    }
    // Duplicate value check — exclude the row being edited
    const duplicate = grades.find(
      (g) => g.id !== id && g.value === parsedValue
    );
    if (duplicate) {
      showToast("error", `A grade with value ${parsedValue} already exists.`);
      return;
    }

    setSavingGradeId(id);
    try {
      const res = await fetch(`/api/settings/preset-grades/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: parsedValue,
          label: editingGrade.label.trim(),
        }),
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        showToast("error", data.error ?? "Failed to save grade.");
      } else {
        setGrades((prev) =>
          prev
            .map((g) =>
              g.id === id
                ? { ...g, value: parsedValue, label: editingGrade.label.trim() }
                : g
            )
            .sort((a, b) => a.value - b.value)
        );
        setEditingGrade(null);
      }
    } catch {
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setSavingGradeId(null);
    }
  }

  /**
   * Deletes a preset grade via DELETE /api/settings/preset-grades/[id].
   * The API route blocks deletion if the grade is in use.
   * @param id - The grade's UUID.
   * @param label - Used in the success/error message.
   */
  async function handleDeleteGrade(id: string, label: string) {
    setDeletingGradeId(id);
    try {
      const res = await fetch(`/api/settings/preset-grades/${id}`, {
        method: "DELETE",
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        showToast("error", data.error ?? "Failed to delete grade.");
      } else {
        setGrades((prev) => prev.filter((g) => g.id !== id));
        showToast("success", `Grade "${label}" deleted.`);
      }
    } catch {
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setDeletingGradeId(null);
    }
  }

  /**
   * Submits the draft new grade row via POST /api/settings/preset-grades.
   */
  async function handleAddGrade() {
    if (!draftGrade) return;

    const parsedValue = parseInt(draftGrade.value, 10);
    if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 100) {
      showToast("error", "Grade value must be a number between 0 and 100.");
      return;
    }
    if (!draftGrade.label.trim()) {
      showToast("error", "Label is required.");
      return;
    }
    const duplicate = grades.find((g) => g.value === parsedValue);
    if (duplicate) {
      showToast("error", `A grade with value ${parsedValue} already exists.`);
      return;
    }

    setAddingGrade(true);
    try {
      const res = await fetch("/api/settings/preset-grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parsedValue, label: draftGrade.label.trim() }),
      });
      const data: {
        success: boolean;
        grade?: PresetGrade;
        error?: string;
      } = await res.json();
      if (!res.ok || !data.success || !data.grade) {
        showToast("error", data.error ?? "Failed to add grade.");
      } else {
        setGrades((prev) =>
          [...prev, data.grade!].sort((a, b) => a.value - b.value)
        );
        setDraftGrade(null);
        showToast("success", `Grade "${draftGrade.label.trim()}" added.`);
      }
    } catch {
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setAddingGrade(false);
    }
  }

  // ── Zoho actions ───────────────────────────────────────────────────────────

  /**
   * Disconnects Zoho Mail by clearing tokens from system_settings.
   * Calls DELETE /api/settings/zoho/disconnect.
   */
  async function handleDisconnectZoho() {
    setDisconnectingZoho(true);
    try {
      const res = await fetch("/api/settings/zoho/disconnect", {
        method: "DELETE",
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        showToast("error", data.error ?? "Failed to disconnect Zoho.");
      } else {
        setZohoConnected(false);
        showToast("success", "Zoho Mail disconnected.");
      }
    } catch {
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setDisconnectingZoho(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl space-y-10">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage class offerings, grade presets, and system connections.
        </p>
      </div>

      {/* ── Section 1: Appearance ─────────────────────────────────────────── */}
      <section aria-labelledby="section-appearance">
        <h2
          id="section-appearance"
          className="text-lg font-semibold text-gray-900 dark:text-white mb-4"
        >
          Appearance
        </h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Dark Mode
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Applies to this device only. Your preference is saved locally.
              </p>
            </div>
            {/* Toggle switch — role="switch" with aria-checked for accessibility */}
            <button
              role="switch"
              aria-checked={isDark}
              onClick={toggleDarkMode}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${
                isDark ? "bg-red-600" : "bg-gray-200"
              }`}
            >
              <span className="sr-only">Toggle dark mode</span>
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isDark ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ── Section 2: Class Types ─────────────────────────────────────────── */}
      <section aria-labelledby="section-class-types">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              id="section-class-types"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Class Types
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Manage the CPR course offerings available for booking and invoicing.
            </p>
          </div>
          <button
            onClick={() => {
              setEditingClassType(null);
              setClassTypePanelOpen(true);
            }}
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            + Add Class Type
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
          {classTypes.length === 0 ? (
            <div className="text-center py-10 text-sm text-gray-500">
              No class types yet. Add your first one.
            </div>
          ) : (
            classTypes.map((ct) => (
              <div key={ct.id} className="flex items-start justify-between gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-900 dark:text-white">
                      {ct.name}
                    </span>
                    {ct.active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                  </div>
                  {ct.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {ct.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span>{ct.duration_minutes} minutes</span>
                    <span>·</span>
                    <span>Capacity: {ct.max_capacity}</span>
                    <span>·</span>
                    <span>
                      $
                      {ct.price.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => {
                      setEditingClassType(ct);
                      setClassTypePanelOpen(true);
                    }}
                    className="text-xs text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white underline underline-offset-2 font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggleClassType(ct)}
                    disabled={togglingClassTypeId === ct.id}
                    className={`text-xs underline underline-offset-2 font-medium disabled:opacity-50 ${
                      ct.active
                        ? "text-red-600 hover:text-red-800"
                        : "text-green-700 hover:text-green-900"
                    }`}
                  >
                    {togglingClassTypeId === ct.id
                      ? "Saving…"
                      : ct.active
                      ? "Deactivate"
                      : "Activate"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ── Section 3: Preset Grades ───────────────────────────────────────── */}
      <section aria-labelledby="section-grades">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              id="section-grades"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Preset Grades
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              These grade values appear as quick-select buttons in the instructor
              grading tool.
            </p>
          </div>
          {!draftGrade && (
            <button
              onClick={() => {
                setDraftGrade({ value: "", label: "" });
                setTimeout(() => draftValueRef.current?.focus(), 50);
              }}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              + Add Grade
            </button>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide w-24">
                  Value
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Label
                </th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {grades.map((grade) => {
                const isEditing = editingGrade?.id === grade.id;
                const isSaving = savingGradeId === grade.id;
                const isDeleting = deletingGradeId === grade.id;
                return (
                  <tr key={grade.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={editingGrade.value}
                          onChange={(e) =>
                            setEditingGrade((prev) =>
                              prev ? { ...prev, value: e.target.value } : prev
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveGrade(grade.id);
                            if (e.key === "Escape") setEditingGrade(null);
                          }}
                          aria-label={`Grade value for ${grade.label}`}
                          className={`${inputClass} w-20`}
                        />
                      ) : (
                        <span
                          className="text-sm text-gray-900 dark:text-white cursor-pointer hover:underline"
                          onClick={() =>
                            setEditingGrade({
                              id: grade.id,
                              value: String(grade.value),
                              label: grade.label,
                            })
                          }
                        >
                          {grade.value}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingGrade.label}
                          onChange={(e) =>
                            setEditingGrade((prev) =>
                              prev ? { ...prev, label: e.target.value } : prev
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveGrade(grade.id);
                            if (e.key === "Escape") setEditingGrade(null);
                          }}
                          onBlur={() => handleSaveGrade(grade.id)}
                          aria-label={`Label for grade ${grade.value}`}
                          className={inputClass}
                        />
                      ) : (
                        <span
                          className="text-sm text-gray-900 dark:text-white cursor-pointer hover:underline"
                          onClick={() =>
                            setEditingGrade({
                              id: grade.id,
                              value: String(grade.value),
                              label: grade.label,
                            })
                          }
                        >
                          {grade.label}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveGrade(grade.id)}
                            disabled={isSaving}
                            className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingGrade(null)}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDeleteGrade(grade.id, grade.label)}
                          disabled={isDeleting}
                          className="text-xs text-red-600 hover:text-red-800 underline underline-offset-2 font-medium disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Draft new-grade row */}
              {draftGrade !== null && (
                <tr className="bg-gray-50 dark:bg-gray-700/30">
                  <td className="px-5 py-3">
                    <input
                      ref={draftValueRef}
                      type="number"
                      min={0}
                      max={100}
                      value={draftGrade.value}
                      onChange={(e) =>
                        setDraftGrade((prev) =>
                          prev ? { ...prev, value: e.target.value } : prev
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddGrade();
                        if (e.key === "Escape") setDraftGrade(null);
                      }}
                      placeholder="0–100"
                      aria-label="New grade value"
                      className={`${inputClass} w-20`}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <input
                      type="text"
                      value={draftGrade.label}
                      onChange={(e) =>
                        setDraftGrade((prev) =>
                          prev ? { ...prev, label: e.target.value } : prev
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddGrade();
                        if (e.key === "Escape") setDraftGrade(null);
                      }}
                      placeholder="e.g. Pass"
                      aria-label="New grade label"
                      className={inputClass}
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={handleAddGrade}
                        disabled={addingGrade}
                        className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                      >
                        {addingGrade ? "Adding…" : "Add"}
                      </button>
                      <button
                        onClick={() => setDraftGrade(null)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {grades.length === 0 && !draftGrade && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-gray-500">
                    No preset grades yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ── Section 4: Zoho Mail ───────────────────────────────────────────── */}
      <section aria-labelledby="section-zoho">
        <div className="mb-4">
          <h2
            id="section-zoho"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            Zoho Mail
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Used for replying to contact form submissions at /admin/contact. All other
            emails go through Resend.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          {zohoConnected ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    Connected
                  </p>
                  {zohoEmail && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Account: {zohoEmail}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={handleDisconnectZoho}
                disabled={disconnectingZoho}
                className="text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
              >
                {disconnectingZoho ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-gray-400 shrink-0" />
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Not connected
                </p>
              </div>
              <a
                href="/api/contact/zoho-auth"
                className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Connect Zoho Mail →
              </a>
            </div>
          )}
        </div>
      </section>

      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ── Section 5: Instructor Payment Routing ──────────────────────────── */}
      <section aria-labelledby="section-routing">
        <div className="mb-4">
          <h2
            id="section-routing"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            Instructor Payment Routing
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Control where online booking payments are sent for each instructor. Defaults
            to the instructor&apos;s own PayPal account when one is connected.
          </p>
        </div>

        {instructors.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5 text-sm text-gray-500 dark:text-gray-400">
            No active instructors found.
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
            {instructors.map((inst) => {
              const fallbackActive =
                inst.payment_routing === "instructor" && !inst.has_active_paypal;
              const businessActive = inst.payment_routing === "business";
              const isSaving = savingRoutingId === inst.id;

              return (
                <div key={inst.id} className="p-5 flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {inst.first_name} {inst.last_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {inst.email}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            inst.has_active_paypal ? "bg-green-500" : "bg-gray-300"
                          }`}
                          aria-hidden
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {inst.has_active_paypal ? "PayPal connected" : "No PayPal"}
                        </span>
                      </div>
                    </div>

                    {/* Pill toggle */}
                    <div
                      role="radiogroup"
                      aria-label="Payment routing"
                      className="inline-flex bg-gray-100 dark:bg-gray-700 rounded-full p-0.5 shrink-0"
                    >
                      <button
                        role="radio"
                        aria-checked={inst.payment_routing === "instructor"}
                        onClick={() => handleRoutingChange(inst.id, "instructor")}
                        disabled={isSaving}
                        className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors disabled:opacity-50 ${
                          inst.payment_routing === "instructor"
                            ? "bg-white dark:bg-gray-900 text-red-600 shadow-sm"
                            : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        }`}
                      >
                        Instructor PayPal
                      </button>
                      <button
                        role="radio"
                        aria-checked={inst.payment_routing === "business"}
                        onClick={() => handleRoutingChange(inst.id, "business")}
                        disabled={isSaving}
                        className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors disabled:opacity-50 ${
                          inst.payment_routing === "business"
                            ? "bg-white dark:bg-gray-900 text-red-600 shadow-sm"
                            : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        }`}
                      >
                        Business PayPal
                      </button>
                    </div>
                  </div>

                  {/* Inline warnings */}
                  {fallbackActive && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-3 py-1.5">
                      Will fall back to business PayPal until this instructor connects a
                      PayPal account at <code>/admin/profile/payment</code>.
                    </p>
                  )}
                  {businessActive && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Online booking payments always go to the business account for this
                      instructor.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Instructor payment account note */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-300">
        Instructors manage their payment account connections from their own profile
        settings.
      </div>

      {/* ── Section 6: Social Feed ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Social Feed
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The Facebook photo strip on the home page is powered by a cache that
            refreshes automatically every day. Use this button to pull the latest
            posts immediately.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleRefreshFeed}
            disabled={refreshingFeed}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors duration-150"
          >
            {refreshingFeed ? "Refreshing…" : "Refresh Feed Now"}
          </button>
          {lastRefreshCount !== null && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {lastRefreshCount} post{lastRefreshCount !== 1 ? "s" : ""} cached
            </span>
          )}
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500">
          The feed also refreshes automatically at 3:00 AM UTC daily via a
          scheduled job. Requires{" "}
          <code className="font-mono">FACEBOOK_PAGE_ACCESS_TOKEN</code> and{" "}
          <code className="font-mono">FACEBOOK_PAGE_ID</code> to be set in the
          environment.
        </p>
      </section>

      {/* Class type add/edit panel */}
      <ClassTypePanel
        open={classTypePanelOpen}
        classType={editingClassType}
        onClose={() => {
          setClassTypePanelOpen(false);
          setEditingClassType(null);
        }}
        onSaved={handleClassTypeSaved}
        onError={(msg) => showToast("error", msg)}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm w-full rounded-lg shadow-lg p-4 flex items-start gap-3 border ${
            toast.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <p className="text-sm font-medium flex-1">{toast.message}</p>
          <button
            onClick={() => setToast(null)}
            className="text-current opacity-60 hover:opacity-100 text-lg leading-none shrink-0"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default SettingsClient;

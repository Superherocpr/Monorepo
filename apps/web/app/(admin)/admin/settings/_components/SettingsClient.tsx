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
import ClassTypeImportPanel from "./ClassTypeImportPanel";
import type { ClassType, CertTypeOption, PresetGrade, InstructorRoutingRow } from "../page";

interface SettingsClientProps {
  classTypes: ClassType[];
  /** All active cert types — used to populate the linked cert dropdown in ClassTypePanel. */
  certTypeOptions: CertTypeOption[];
  presetGrades: PresetGrade[];
  instructors: InstructorRoutingRow[];
  zohoConnected: boolean;
  zohoEmail: string | null;
  /** Value of the ?zoho= query param — "connected" | "error" | null */
  zohoParam: string | null;
  /** Initial value of the legacy_site_enabled system_settings flag. */
  legacySiteEnabled: boolean;
  /** Whether the current user is a super_admin — gates the Legacy Site section. */
  isSuperAdmin: boolean;
  /**
   * Optional fully-rendered Enrollware Bookmarklet block. When provided, the
   * settings page exposes an "Enrollware" tab whose content is this node.
   * Rendered as an opaque slot so this component doesn't need to know about
   * the bookmarklet's data dependencies (api key state, site URL, etc.).
   */
  enrollwareSlot?: React.ReactNode;
  /**
   * Optional fully-rendered Locations management block. When provided, the
   * settings page exposes a "Locations" tab whose content is this node.
   * Rendered as an opaque slot so this component doesn't need to know about
   * the locations data dependencies.
   */
  locationsSlot?: React.ReactNode;
}

/** All tab identifiers for the settings page. Order matches the nav. */
type SettingsTabId =
  | "general"
  | "class-types"
  | "grades"
  | "zoho"
  | "routing"
  | "social"
  | "locations"
  | "enrollware";

/** Tab nav definition — label + id pairs in display order. */
interface TabDef {
  id: SettingsTabId;
  label: string;
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
 * @param isSuperAdmin - Whether the current user is a super_admin. Gates the Legacy Site section.
 */
const SettingsClient: React.FC<SettingsClientProps> = ({
  classTypes: initialClassTypes,
  certTypeOptions,
  presetGrades: initialPresetGrades,
  instructors: initialInstructors,
  zohoConnected: initialZohoConnected,
  zohoEmail,
  zohoParam,
  legacySiteEnabled: initialLegacySiteEnabled,
  isSuperAdmin,
  enrollwareSlot,
  locationsSlot,
}) => {
  const router = useRouter();

  // ── Tabs ───────────────────────────────────────────────────────────────────
  // We render every section all the time (just hide inactive ones with CSS) so
  // that in-progress edits — drafted grades, dirty toggles, etc. — survive a
  // tab switch.
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  const tabs: TabDef[] = [
    { id: "general", label: "General" },
    { id: "class-types", label: "Class Types" },
    ...(locationsSlot ? [{ id: "locations" as const, label: "Locations" }] : []),
    { id: "grades", label: "Grades" },
    { id: "routing", label: "Payment Routing" },
    { id: "social", label: "Social Feed" },
    { id: "zoho", label: "Zoho Mail" },
    ...(enrollwareSlot ? [{ id: "enrollware" as const, label: "Enrollware" }] : []),
  ];

  /** Returns the className applied to a section wrapper based on active tab. */
  function tabClass(id: SettingsTabId): string {
    return activeTab === id ? "" : "hidden";
  }

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

  // ── Legacy site flag ───────────────────────────────────────────────────────
  // Persisted server-side in system_settings.legacy_site_enabled.
  // When true, the public home page (/) renders the classic clone instead of the modern site.
  const [legacySiteEnabled, setLegacySiteEnabled] = useState(initialLegacySiteEnabled);
  const [savingLegacySite, setSavingLegacySite] = useState(false);

  /**
   * Toggles the legacy site flag. Calls POST /api/settings/legacy-site, persists
   * to system_settings, and refreshes the router so any server components reading
   * the flag pick up the new value. Rolls back optimistically on error.
   * Side effects: writes to DB, shows a toast.
   */
  async function toggleLegacySite() {
    if (savingLegacySite) return;
    const next = !legacySiteEnabled;

    // Optimistic update for instant UI feedback
    setLegacySiteEnabled(next);
    setSavingLegacySite(true);

    try {
      const res = await fetch("/api/settings/legacy-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        // Roll back on error
        setLegacySiteEnabled(!next);
        showToast("error", data?.error ?? "Failed to update legacy site setting.");
      } else {
        showToast(
          "success",
          next ? "Legacy site is now live on /." : "Modern site restored on /."
        );
        // Refresh server components so the home page picks up the new flag
        router.refresh();
      }
    } catch {
      setLegacySiteEnabled(!next);
      showToast("error", "Something went wrong. Please try again.");
    } finally {
      setSavingLegacySite(false);
    }
  }

  // ── Class types ────────────────────────────────────────────────────────────
  const [classTypes, setClassTypes] = useState<ClassType[]>(initialClassTypes);
  const [classTypePanelOpen, setClassTypePanelOpen] = useState(false);
  const [classTypeImportPanelOpen, setClassTypeImportPanelOpen] = useState(false);
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

  // ── Class type delete ──────────────────────────────────────────────────────
  const [deletingClassTypeId, setDeletingClassTypeId] = useState<string | null>(null);
  const [deleteClassTypeLoading, setDeleteClassTypeLoading] = useState(false);
  const [deleteClassTypeError, setDeleteClassTypeError] = useState<string | null>(null);

  /**
   * Deletes a class type via DELETE /api/settings/class-types/[id].
   * Refused by the server if any sessions reference the class type.
   * @param id - UUID of the class type to delete.
   */
  async function handleDeleteClassType(id: string) {
    setDeleteClassTypeLoading(true);
    setDeleteClassTypeError(null);
    try {
      const res = await fetch(`/api/settings/class-types/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!json.success) {
        setDeleteClassTypeError(json.error ?? "Failed to delete class type.");
        return;
      }
      // Remove the deleted item from local state immediately so the UI updates
      // without waiting for a server round-trip.
      setClassTypes((prev) => prev.filter((ct) => ct.id !== id));
      setDeletingClassTypeId(null);
      showToast("success", "Class type deleted.");
    } catch {
      setDeleteClassTypeError("Network error. Please try again.");
    } finally {
      setDeleteClassTypeLoading(false);
    }
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

      {/* Tab navigation — horizontally scrollable on narrow viewports so all
          tabs stay reachable on mobile without wrapping. */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 -mt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-controls={`tab-panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Section: Legacy Site — super_admin only ──────────────────────── */}
      {isSuperAdmin && <section aria-labelledby="section-legacy-site" className={tabClass("general")}>
        <h2
          id="section-legacy-site"
          className="text-lg font-semibold text-gray-900 dark:text-white mb-4"
        >
          Legacy Site
        </h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Show Legacy Home Page
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                When enabled, the home page (/) shows the classic SuperheroCPR site.
                When disabled, the modern site is shown.
              </p>
            </div>
            {/* Toggle switch — role="switch" with aria-checked for accessibility */}
            <button
              role="switch"
              aria-checked={legacySiteEnabled}
              onClick={toggleLegacySite}
              disabled={savingLegacySite}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 ${
                legacySiteEnabled ? "bg-red-600" : "bg-gray-200"
              }`}
            >
              <span className="sr-only">Toggle legacy site</span>
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  legacySiteEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </section>}

      {/* ── Section 1: Appearance ─────────────────────────────────────────── */}
      <section aria-labelledby="section-appearance" className={tabClass("general")}>
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

      {/* ── Section 2: Class Types ─────────────────────────────────────────── */}
      <section aria-labelledby="section-class-types" className={tabClass("class-types")}>
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setClassTypeImportPanelOpen(true)}
              className="flex items-center gap-1.5 border border-gray-300 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Import CSV / XLSX
            </button>
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
        </div>

        {classTypes.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-500">
            No class types yet. Add your first one.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {classTypes.map((ct) => (
              <div
                key={ct.id}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                {deletingClassTypeId === ct.id ? (
                  // ── Inline delete confirmation ─────────────────────────
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3">
                    <p className="mb-1 text-sm font-medium text-red-700">
                      Delete &ldquo;{ct.name}&rdquo;?
                    </p>
                    {deleteClassTypeError && (
                      <p className="mb-2 text-xs text-red-600">{deleteClassTypeError}</p>
                    )}
                    <p className="mb-3 text-xs text-red-600">
                      This cannot be undone. Class types linked to existing sessions cannot be deleted.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleDeleteClassType(ct.id)}
                        disabled={deleteClassTypeLoading}
                        className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteClassTypeLoading ? "Deleting…" : "Delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingClassTypeId(null);
                          setDeleteClassTypeError(null);
                        }}
                        disabled={deleteClassTypeLoading}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {ct.name}
                      </span>
                      {ct.active ? (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                          Inactive
                        </span>
                      )}
                    </div>
                    {ct.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                        {ct.description}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">
                      {ct.duration_minutes} min · Capacity {ct.max_capacity} ·{" "}
                      ${ct.price.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                    {/* Show the linked cert type name if one is set */}
                    {ct.cert_type_id && (
                      <p className="mt-1 text-xs text-gray-400">
                        Cert:{" "}
                        {certTypeOptions.find((c) => c.id === ct.cert_type_id)?.name ?? "Unknown"}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingClassType(ct);
                          setClassTypePanelOpen(true);
                        }}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleClassType(ct)}
                        disabled={togglingClassTypeId === ct.id}
                        className={`rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
                          ct.active
                            ? "border-orange-300 text-orange-600 hover:bg-orange-50"
                            : "border-green-300 text-green-700 hover:bg-green-50"
                        }`}
                      >
                        {togglingClassTypeId === ct.id
                          ? "Saving…"
                          : ct.active
                          ? "Deactivate"
                          : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingClassTypeId(ct.id);
                          setDeleteClassTypeError(null);
                        }}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Preset Grades ───────────────────────────────────────── */}
      <section aria-labelledby="section-grades" className={tabClass("grades")}>
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

      {/* ── Section 4: Zoho Mail ───────────────────────────────────────────── */}
      <section aria-labelledby="section-zoho" className={tabClass("zoho")}>
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

      {/* ── Section 5: Instructor Payment Routing ──────────────────────────── */}
      <section aria-labelledby="section-routing" className={tabClass("routing")}>
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

      {/* Instructor payment account note — grouped with Payment Routing tab */}
      <div className={`bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-300 ${tabClass("routing")}`}>
        Instructors manage their payment account connections from their own profile
        settings.
      </div>

      {/* ── Section 6: Social Feed ─────────────────────────────────────────── */}
      <section className={`space-y-4 ${tabClass("social")}`}>
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

      {/* ── Section 7: Locations (optional slot) ──────────────────────────── */}
      {locationsSlot && (
        <section className={tabClass("locations")}>
          {locationsSlot}
        </section>
      )}

      {/* ── Section 8: Enrollware Bookmarklet (optional slot) ─────────────── */}
      {enrollwareSlot && (
        <section className={tabClass("enrollware")}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Enrollware Bookmarklet
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              A one-click tool that auto-fills new classes on Enrollware from
              your SuperheroCPR roster. Generate it once, save it to your
              browser&apos;s bookmarks bar, and click it whenever you&apos;re on
              an Enrollware class-edit page.
            </p>
          </div>
          {enrollwareSlot}
        </section>
      )}

      {/* Class type add/edit panel */}
      <ClassTypePanel
        open={classTypePanelOpen}
        classType={editingClassType}
        certTypeOptions={certTypeOptions}
        onClose={() => {
          setClassTypePanelOpen(false);
          setEditingClassType(null);
        }}
        onSaved={handleClassTypeSaved}
        onError={(msg) => showToast("error", msg)}
      />

      {/* Class type bulk import panel */}
      {classTypeImportPanelOpen && (
        <ClassTypeImportPanel
          onClose={() => setClassTypeImportPanelOpen(false)}
          onImported={(_count) => {
            setClassTypeImportPanelOpen(false);
            router.refresh();
          }}
        />
      )}

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

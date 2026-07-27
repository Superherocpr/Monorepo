"use client";

/**
 * InstructorSettingsClient component
 * Tab container for the instructor-facing settings page.
 * Tabs: "Enrollware" (bookmarklet setup) and "About Page" (bio editor).
 * Owns tab state and the shared toast so callbacks can be passed to BioSettingsSection.
 * Used by: /admin/settings/page.tsx (instructor role branch)
 */

import React, { useState } from "react";
import BioSettingsSection from "./BioSettingsSection";

type TabId = "enrollware" | "about";

interface TabDef {
  id: TabId;
  label: string;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

interface InstructorSettingsClientProps {
  /** Rendered BookmarkletSetup slot — passed as an opaque node. */
  enrollwareSlot: React.ReactNode;
  /** Current saved headshot URL. Null if not yet uploaded. */
  initialPhoto: string | null;
  /** Current saved bio description. */
  initialDescription: string;
  /** Current saved credentials string (comma-separated). */
  initialCredentials: string;
}

const TABS: TabDef[] = [
  { id: "enrollware", label: "Enrollware" },
  { id: "about", label: "About Page" },
];

/**
 * Root client component for the instructor settings page.
 * Owns tab state and toast notifications shared across all tabs.
 * Renders BioSettingsSection directly so it can pass live callback props.
 * @param enrollwareSlot - BookmarkletSetup content for the Enrollware tab.
 * @param initialPhoto - Saved headshot URL from the DB.
 * @param initialDescription - Saved bio description from the DB.
 * @param initialCredentials - Saved credentials string from the DB.
 */
const InstructorSettingsClient: React.FC<InstructorSettingsClientProps> = ({
  enrollwareSlot,
  initialPhoto,
  initialDescription,
  initialCredentials,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("enrollware");
  const [toast, setToast] = useState<Toast | null>(null);

  /**
   * Shows a toast notification. Success auto-dismisses after 4 seconds.
   * @param type - "success" or "error"
   * @param message - The message text.
   */
  function showToast(type: "success" | "error", message: string): void {
    setToast({ type, message });
    if (type === "success") {
      setTimeout(() => setToast(null), 4000);
    }
  }

  return (
    <div className="max-w-3xl space-y-10">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your Enrollware integration and public About page bio.
          </p>
        </div>
        <a
          href="/admin/reference"
          className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors mt-1"
        >
          Admin feature reference →
        </a>
      </div>

      {/* Tab navigation */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 -mt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
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

      {/* Tab panels — both rendered, inactive hidden via CSS so unsaved edits
          survive switching tabs. */}
      <div
        id="tab-panel-enrollware"
        role="tabpanel"
        aria-labelledby="tab-enrollware"
        className={activeTab === "enrollware" ? "" : "hidden"}
      >
        {enrollwareSlot}
      </div>

      <div
        id="tab-panel-about"
        role="tabpanel"
        aria-labelledby="tab-about"
        className={activeTab === "about" ? "" : "hidden"}
      >
        <BioSettingsSection
          initialPhoto={initialPhoto}
          initialDescription={initialDescription}
          initialCredentials={initialCredentials}
          onSuccess={(msg) => showToast("success", msg)}
          onError={(msg) => showToast("error", msg)}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border p-4 shadow-lg ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <p className="text-sm font-medium">{toast.message}</p>
        </div>
      )}
    </div>
  );
};

export default InstructorSettingsClient;

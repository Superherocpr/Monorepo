"use client";

/**
 * ManagerSettingsClient component
 * Tab container for the manager-facing settings page.
 * Tabs: "Locations" (existing location management) and "How-To Guides".
 * Used by: /admin/settings/page.tsx (manager role branch)
 */

import React, { useState } from "react";
import LocationsClient, { type LocationWithCount } from "@/app/(admin)/_components/LocationsClient";
import WalkthroughsPanel from "@/components/tours/WalkthroughsPanel";

type TabId = "locations" | "how-to-guides";

interface TabDef {
  id: TabId;
  label: string;
}

interface ManagerSettingsClientProps {
  /** Locations fetched server-side, passed straight through to LocationsClient. */
  initialLocations: LocationWithCount[];
}

const TABS: TabDef[] = [
  { id: "locations", label: "Locations" },
  { id: "how-to-guides", label: "How-To Guides" },
];

/**
 * Root client component for the manager settings page.
 * Owns tab state; each panel is a thin wrapper around an existing component.
 * @param initialLocations - Locations fetched server-side.
 */
const ManagerSettingsClient: React.FC<ManagerSettingsClientProps> = ({
  initialLocations,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("locations");

  return (
    <div className="space-y-6">
      {/* Tab navigation */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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

      {/* Tab panels: both rendered, inactive hidden via CSS so in-progress
          edits survive switching tabs (matches SettingsClient / InstructorSettingsClient). */}
      <div
        id="tab-panel-locations"
        role="tabpanel"
        aria-labelledby="tab-locations"
        className={activeTab === "locations" ? "" : "hidden"}
      >
        <LocationsClient initialLocations={initialLocations} userRole="manager" />
      </div>

      <div
        id="tab-panel-how-to-guides"
        role="tabpanel"
        aria-labelledby="tab-how-to-guides"
        className={activeTab === "how-to-guides" ? "" : "hidden"}
      >
        <WalkthroughsPanel viewerRole="manager" showAllRoles />
      </div>
    </div>
  );
};

export default ManagerSettingsClient;

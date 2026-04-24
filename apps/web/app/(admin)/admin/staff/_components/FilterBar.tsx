/**
 * FilterBar component
 * Renders status and role filter pills for the staff management page.
 * Uses design system pill styles: red-600 when active, white/gray-200 border when inactive.
 * Used by: StaffManagement
 */

import React from "react";

interface FilterBarProps {
  status: string;
  setStatus: (status: string) => void;
  role: string;
  setRole: (role: string) => void;
}

const statusOptions = ["All", "Active", "Deactivated"];
const roleOptions = ["All", "Instructor", "Manager", "Super Admin", "Inspector"];

/**
 * Pill button filter row for staff status and role.
 * All filtering is client-side — no network calls on filter change.
 * @param status - Currently active status filter value.
 * @param setStatus - Callback to update the status filter.
 * @param role - Currently active role filter value.
 * @param setRole - Callback to update the role filter.
 */
const FilterBar: React.FC<FilterBarProps> = ({ status, setStatus, role, setRole }) => (
  <div className="flex flex-wrap gap-6">
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</span>
      {statusOptions.map((opt) => (
        <button
          key={opt}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 ${
            status === opt
              ? "bg-red-600 text-white"
              : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
          aria-pressed={status === opt}
          onClick={() => setStatus(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Role</span>
      {roleOptions.map((opt) => (
        <button
          key={opt}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 ${
            role === opt
              ? "bg-red-600 text-white"
              : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
          aria-pressed={role === opt}
          onClick={() => setRole(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);

export default FilterBar;

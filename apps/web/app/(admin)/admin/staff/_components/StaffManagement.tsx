"use client";

/**
 * StaffManagement component
 * Renders the full staff management UI for /admin/staff.
 * Handles client-side filtering (status, role, search), toast notifications,
 * invite panel open/close, and passes action callbacks to StaffList.
 * Used by: /admin/staff/page.tsx
 */

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import FilterBar from "./FilterBar";
import StaffList from "./StaffList";
import InvitePanel from "./InvitePanel";
import type { UserRole } from "@/types/users";

/** A staff member as returned by the server component's Supabase query. */
export interface StaffMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: Exclude<UserRole, "customer">;
  deactivated: boolean;
  deactivated_at: string | null;
  created_at: string;
}

interface StaffManagementProps {
  staffMembers: StaffMember[];
  ownerEmails: string[];
  currentUserId: string;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

/**
 * Root client component for the staff management page.
 * Owns filter state, toast state, and invite panel visibility.
 * Refreshes staff data via router.refresh() after any mutation.
 * @param staffMembers - All staff profiles fetched server-side.
 * @param ownerEmails - Protected owner emails — action buttons are hidden for these members.
 * @param currentUserId - The logged-in super admin's user ID (prevents self-demotion).
 */
const StaffManagement: React.FC<StaffManagementProps> = ({
  staffMembers,
  ownerEmails,
  currentUserId,
}) => {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  /**
   * Displays a toast notification. Success toasts auto-dismiss after 4 seconds.
   * Error toasts stay until the user dismisses them manually.
   * @param type - "success" or "error"
   * @param message - The message to display.
   */
  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    if (type === "success") {
      setTimeout(() => setToast(null), 4000);
    }
  }

  /**
   * Re-runs the server component query to pick up the latest staff data.
   * Called after any mutation (role change, deactivate, reactivate, invite).
   */
  function refreshList() {
    router.refresh();
  }

  // Client-side filter — all staff data is already loaded from the server.
  // Search matches against full name, email, and phone (case-insensitive).
  const filtered = staffMembers.filter((staff) => {
    const statusMatch =
      statusFilter === "All" ||
      (statusFilter === "Active" && !staff.deactivated) ||
      (statusFilter === "Deactivated" && staff.deactivated);
    const roleMatch =
      roleFilter === "All" ||
      (roleFilter === "Instructor" && staff.role === "instructor") ||
      (roleFilter === "Manager" && staff.role === "manager") ||
      (roleFilter === "Super Admin" && staff.role === "super_admin") ||
      (roleFilter === "Inspector" && staff.role === "inspector");
    const q = searchQuery.trim().toLowerCase();
    const searchMatch =
      !q ||
      `${staff.first_name} ${staff.last_name}`.toLowerCase().includes(q) ||
      staff.email.toLowerCase().includes(q) ||
      (staff.phone ?? "").toLowerCase().includes(q);
    return statusMatch && roleMatch && searchMatch;
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage staff accounts, roles, and access.
          </p>
        </div>
        <button
          onClick={() => setInvitePanelOpen(true)}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          + Invite Staff Member
        </button>
      </div>

      {/* Search bar — filters by name, email, or phone client-side */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          aria-label="Search staff"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status and role filters */}
      <FilterBar
        status={statusFilter}
        setStatus={setStatusFilter}
        role={roleFilter}
        setRole={setRoleFilter}
      />

      {/* Staff list — table on desktop, cards on mobile */}
      <StaffList
        staff={filtered}
        ownerEmails={ownerEmails}
        currentUserId={currentUserId}
        onSuccess={(msg) => {
          showToast("success", msg);
          refreshList();
        }}
        onError={(msg) => showToast("error", msg)}
        onInvite={() => setInvitePanelOpen(true)}
      />

      {/* Invite staff member slide-in panel */}
      <InvitePanel
        open={invitePanelOpen}
        onClose={() => setInvitePanelOpen(false)}
        onSuccess={(email) => {
          setInvitePanelOpen(false);
          showToast("success", `Invitation sent to ${email}.`);
          refreshList();
        }}
        onError={(msg) => showToast("error", msg)}
      />

      {/* Toast notification — bottom-right, auto-dismisses on success */}
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

export default StaffManagement;

"use client";

/**
 * StaffList component
 * Renders filtered staff as a table on desktop and cards on mobile.
 * Handles inline role-change dropdown and deactivate/reactivate confirmation UI.
 * All mutations call the /api/staff/[id]/* routes and report results via callbacks.
 * Used by: StaffManagement
 */

import React, { useState } from "react";
import { Users } from "lucide-react";
import type { StaffMember } from "./StaffManagement";
import type { UserRole } from "@/types/users";

interface StaffListProps {
  staff: StaffMember[];
  ownerEmails: string[];
  currentUserId: string;
  /** Called with a success message on any successful mutation — also triggers list refresh. */
  onSuccess: (message: string) => void;
  /** Called with an error message on any failed mutation. */
  onError: (message: string) => void;
  /** Called when the empty-state invite button is clicked. */
  onInvite: () => void;
}

/** Display labels for each staff role. */
const ROLE_LABELS: Record<Exclude<UserRole, "customer">, string> = {
  instructor: "Instructor",
  manager: "Manager",
  super_admin: "Super Admin",
  inspector: "Inspector",
};

/** Tailwind badge classes for each staff role, per design system. */
const ROLE_BADGE_CLASSES: Record<Exclude<UserRole, "customer">, string> = {
  instructor: "bg-blue-100 text-blue-800",
  manager: "bg-purple-100 text-purple-800",
  super_admin: "bg-red-100 text-red-700",
  inspector: "bg-teal-100 text-teal-800",
};

/** Role options available in the change-role dropdown (all staff roles). */
const STAFF_ROLES: Array<{ value: Exclude<UserRole, "customer">; label: string }> = [
  { value: "instructor", label: "Instructor" },
  { value: "manager", label: "Manager" },
  { value: "super_admin", label: "Super Admin" },
  { value: "inspector", label: "Inspector" },
];

/** Formats a timestamp as "Mon YYYY" (e.g. "Jan 2024"). */
function formatJoinDate(createdAt: string): string {
  return new Date(createdAt).toLocaleString("default", {
    month: "short",
    year: "numeric",
  });
}

/** Formats a date string as a short locale date (e.g. "1/15/2025"). */
function formatDeactivatedDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Renders the staff list with inline role change and deactivate/reactivate actions.
 * Action buttons are hidden entirely for the owner email and the change-role button
 * is also hidden on the logged-in user's own row (prevents self-demotion).
 * @param staff - Filtered staff members to display.
 * @param ownerEmails - Protected owner emails — no action buttons shown for these rows.
 * @param currentUserId - Logged-in user's ID — change-role hidden on own row.
 * @param onSuccess - Callback to show success toast and refresh the list.
 * @param onError - Callback to show an error toast.
 * @param onInvite - Callback to open the invite panel (used in empty state).
 */
const StaffList: React.FC<StaffListProps> = ({
  staff,
  ownerEmails,
  currentUserId,
  onSuccess,
  onError,
  onInvite,
}) => {
  // Track which row has the change-role dropdown open
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);
  // The selected role value in the change-role dropdown
  const [newRole, setNewRole] = useState<Exclude<UserRole, "customer">>("instructor");
  // Track which row has the deactivate confirmation open
  const [deactivatingFor, setDeactivatingFor] = useState<string | null>(null);
  // Track which staff ID is waiting on an API response
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  /**
   * Sends a PATCH request to update a staff member's role.
   * Shows a note about payment account setup if changing to instructor.
   * @param staffId - The target staff member's profile ID.
   * @param targetRole - The new role to assign.
   */
  async function handleRoleChange(
    staffId: string,
    targetRole: Exclude<UserRole, "customer">
  ) {
    setLoadingAction(staffId);
    try {
      const res = await fetch(`/api/staff/${staffId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to update role.");
      } else {
        setChangingRoleFor(null);
        const note =
          targetRole === "instructor"
            ? " Remind them to connect a payment account at Admin → Settings → Payment."
            : "";
        onSuccess(`Role updated to ${ROLE_LABELS[targetRole]}.${note}`);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  /**
   * Sends a PATCH request to deactivate a staff member.
   * Blocks their Supabase auth login via the API route.
   * @param staffId - The target staff member's profile ID.
   * @param fullName - Used in the success message.
   */
  async function handleDeactivate(staffId: string, fullName: string) {
    setLoadingAction(staffId);
    try {
      const res = await fetch(`/api/staff/${staffId}/deactivate`, {
        method: "PATCH",
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to deactivate account.");
      } else {
        setDeactivatingFor(null);
        onSuccess(`${fullName} has been deactivated.`);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  /**
   * Sends a PATCH request to reactivate a deactivated staff member.
   * Restores their Supabase auth login via the API route. No confirmation required.
   * @param staffId - The target staff member's profile ID.
   * @param fullName - Used in the success message.
   */
  async function handleReactivate(staffId: string, fullName: string) {
    setLoadingAction(staffId);
    try {
      const res = await fetch(`/api/staff/${staffId}/reactivate`, {
        method: "PATCH",
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to reactivate account.");
      } else {
        onSuccess(`${fullName} has been reactivated.`);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  // Empty state — shown when no staff match the current filters
  if (staff.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg text-center py-16">
        <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900">No staff members yet.</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
          Get started by inviting your first staff member.
        </p>
        <button
          onClick={onInvite}
          className="mt-4 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Invite your first staff member
        </button>
      </div>
    );
  }

  // Shared inline change-role UI — rendered in both table and mobile card
  function renderChangeRoleUI(member: StaffMember, fullName: string) {
    const isLoading = loadingAction === member.id;
    const isChangingRole = changingRoleFor === member.id;
    const isSelf = member.id === currentUserId;

    if (isSelf) return null;

    return isChangingRole ? (
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={newRole}
          onChange={(e) =>
            setNewRole(e.target.value as Exclude<UserRole, "customer">)
          }
          aria-label={`Change role for ${fullName}`}
          className="border border-gray-300 rounded-lg px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
        >
          {STAFF_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => handleRoleChange(member.id, newRole)}
          disabled={isLoading}
          className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors"
        >
          {isLoading ? "Saving…" : "Save Role"}
        </button>
        <button
          onClick={() => setChangingRoleFor(null)}
          disabled={isLoading}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
        >
          Cancel
        </button>
      </div>
    ) : (
      <button
        onClick={() => {
          setNewRole(member.role);
          setChangingRoleFor(member.id);
          setDeactivatingFor(null);
        }}
        className="text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2 font-medium"
      >
        Change Role
      </button>
    );
  }

  // Shared deactivate / reactivate UI — rendered in both table and mobile card
  function renderDeactivateUI(member: StaffMember, fullName: string) {
    const isLoading = loadingAction === member.id;
    const isDeactivating = deactivatingFor === member.id;

    if (member.deactivated) {
      return (
        <button
          onClick={() => handleReactivate(member.id, fullName)}
          disabled={isLoading}
          aria-label={`Reactivate ${fullName}`}
          className="text-xs text-green-700 hover:text-green-900 underline underline-offset-2 font-medium disabled:opacity-50"
        >
          {isLoading ? "Reactivating…" : "Reactivate"}
        </button>
      );
    }

    return isDeactivating ? (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs space-y-2">
        <p className="text-gray-700">
          Deactivate {member.first_name}? They will no longer be able to log in.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleDeactivate(member.id, fullName)}
            disabled={isLoading}
            className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors"
          >
            {isLoading ? "Deactivating…" : "Deactivate"}
          </button>
          <button
            onClick={() => setDeactivatingFor(null)}
            disabled={isLoading}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={() => {
          setDeactivatingFor(member.id);
          setChangingRoleFor(null);
        }}
        aria-label={`Deactivate ${fullName}`}
        className="text-xs text-red-600 hover:text-red-800 underline underline-offset-2 font-medium"
      >
        Deactivate
      </button>
    );
  }

  return (
    <>
      {/* ── Desktop table ───────────────────────────────────────────────────── */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                Name
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                Role
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                Joined
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {staff.map((member) => {
              const isOwner = ownerEmails.includes(member.email.toLowerCase());
              const fullName = `${member.first_name} ${member.last_name}`;
              return (
                <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-gray-900 text-sm">
                      {fullName}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {member.email}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE_CLASSES[member.role]}`}
                    >
                      {ROLE_LABELS[member.role]}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {member.deactivated ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Deactivated
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">
                    <div>Since {formatJoinDate(member.created_at)}</div>
                    {member.deactivated && member.deactivated_at && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Deactivated {formatDeactivatedDate(member.deactivated_at)}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {/* All action buttons are hidden for the owner */}
                    {!isOwner && (
                      <div className="space-y-2">
                        {renderChangeRoleUI(member, fullName)}
                        {renderDeactivateUI(member, fullName)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ────────────────────────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        {staff.map((member) => {
          const isOwner = ownerEmails.includes(member.email.toLowerCase());
          const fullName = `${member.first_name} ${member.last_name}`;
          return (
            <div
              key={member.id}
              className="bg-white border border-gray-200 rounded-lg shadow-sm p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-gray-900 text-sm">
                    {fullName}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{member.email}</div>
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE_CLASSES[member.role]}`}
                  >
                    {ROLE_LABELS[member.role]}
                  </span>
                  {member.deactivated ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      Deactivated
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Active
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-500 mt-2">
                Since {formatJoinDate(member.created_at)}
                {member.deactivated && member.deactivated_at && (
                  <span className="ml-2 text-gray-400">
                    · Deactivated {formatDeactivatedDate(member.deactivated_at)}
                  </span>
                )}
              </div>

              {/* Action buttons — hidden for owner */}
              {!isOwner && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                  {renderChangeRoleUI(member, fullName)}
                  {renderDeactivateUI(member, fullName)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default StaffList;

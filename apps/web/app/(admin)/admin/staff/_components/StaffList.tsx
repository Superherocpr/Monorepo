"use client";

/**
 * StaffList component
 * Renders filtered staff as a table on desktop and cards on mobile.
 * Handles inline role-change, deactivate/reactivate, edit-contact (email + phone),
 * and permanent account deletion confirmation UIs.
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
  /** Called when the Edit Bio button is clicked for an instructor. */
  onEditBio: (member: StaffMember) => void;
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
 * Renders the staff list with inline role change, deactivate/reactivate,
 * edit-contact (email + phone), and permanent delete confirmation actions.
 * Action buttons are hidden entirely for the owner email. The delete action
 * is also hidden on the logged-in user's own row (prevents self-deletion).
 * @param staff - Filtered staff members to display.
 * @param ownerEmails - Protected owner emails — no action buttons shown for these rows.
 * @param currentUserId - Logged-in user's ID — change-role and delete hidden on own row.
 * @param onSuccess - Callback to show success toast and refresh the list.
 * @param onError - Callback to show an error toast.
 * @param onInvite - Callback to open the invite panel (used in empty state).
 * @param onEditBio - Callback to open the bio edit panel for an instructor.
 */
const StaffList: React.FC<StaffListProps> = ({
  staff,
  ownerEmails,
  currentUserId,
  onSuccess,
  onError,
  onInvite,
  onEditBio,
}) => {
  // Track which row has the change-role dropdown open
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);
  // The selected role value in the change-role dropdown
  const [newRole, setNewRole] = useState<Exclude<UserRole, "customer">>("instructor");
  // Track which row has the deactivate confirmation open
  const [deactivatingFor, setDeactivatingFor] = useState<string | null>(null);
  // Track which row has the edit-contact form open
  const [editingContactFor, setEditingContactFor] = useState<string | null>(null);
  // Draft values pre-filled when the edit-contact form opens
  const [firstNameDraft, setFirstNameDraft] = useState("");
  const [lastNameDraft, setLastNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  // Track which row has the delete confirmation open
  const [deletingFor, setDeletingFor] = useState<string | null>(null);
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
      <div className="w-full flex items-center gap-2 flex-wrap">
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
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 transition-colors"
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
          className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-green-50 text-green-700 border-green-200 hover:bg-green-100 disabled:opacity-50 transition-colors"
        >
          {isLoading ? "Reactivating…" : "Reactivate"}
        </button>
      );
    }

    return isDeactivating ? (
      <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-xs space-y-2">
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
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition-colors"
      >
        Deactivate
      </button>
    );
  }

  /**
   * Opens the edit-contact form pre-filled with the member's current values.
   * Closes any other open inline panels to keep the UI uncluttered.
   * @param staffId - The target staff member's profile ID.
   * @param currentFirstName - Current first name to pre-fill.
   * @param currentLastName - Current last name to pre-fill.
   * @param currentEmail - Current email address to pre-fill.
   * @param currentPhone - Current phone number to pre-fill (may be null).
   */
  function openEditContact(
    staffId: string,
    currentFirstName: string,
    currentLastName: string,
    currentEmail: string,
    currentPhone: string | null
  ) {
    setEditingContactFor(staffId);
    setFirstNameDraft(currentFirstName);
    setLastNameDraft(currentLastName);
    setEmailDraft(currentEmail);
    setPhoneDraft(currentPhone ?? "");
    setChangingRoleFor(null);
    setDeactivatingFor(null);
    setDeletingFor(null);
  }

  /**
   * Sends a PATCH request to update name, email, and/or phone for a staff member.
   * Updates both profiles and auth.users for email changes.
   * @param staffId - The target staff member's profile ID.
   * @param fullName - Used in the success message.
   */
  async function handleUpdateContact(staffId: string, fullName: string) {
    setLoadingAction(staffId);
    try {
      const res = await fetch(`/api/staff/${staffId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstNameDraft.trim(),
          last_name: lastNameDraft.trim(),
          email: emailDraft.trim().toLowerCase(),
          phone: phoneDraft.trim(),
        }),
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to update contact details.");
      } else {
        setEditingContactFor(null);
        onSuccess(`Contact details updated for ${fullName}.`);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  /**
   * Sends a POST request to regenerate a password setup link and re-send
   * the invitation email to an existing active staff member.
   * Useful when the original invite email was lost or the link expired.
   * @param staffId - The target staff member's profile ID.
   * @param fullName - Used in the success message.
   */
  async function handleResendInvite(staffId: string, fullName: string) {
    setLoadingAction(staffId);
    try {
      const res = await fetch(`/api/staff/${staffId}/resend-invite`, {
        method: "POST",
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to resend invite.");
      } else {
        onSuccess(`Invite resent to ${fullName}.`);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  /**
   * Sends a DELETE request to permanently remove a staff member's account.
   * The API route blocks deletion if the member has class sessions on record.
   * @param staffId - The target staff member's profile ID.
   * @param fullName - Used in the success message.
   */
  async function handleDelete(staffId: string, fullName: string) {
    setLoadingAction(staffId);
    try {
      const res = await fetch(`/api/staff/${staffId}/delete`, {
        method: "DELETE",
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to delete account.");
      } else {
        setDeletingFor(null);
        onSuccess(`${fullName}'s account has been permanently deleted.`);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  /**
   * Renders a "Resend Invite" button for active (non-deactivated) staff members.
   * Regenerates the password setup link and re-sends the invitation email.
   * Hidden for deactivated accounts — they cannot log in regardless.
   * @param member - The staff member row.
   * @param fullName - Full display name used in the success message.
   */
  function renderResendInviteButton(member: StaffMember, fullName: string) {
    if (member.deactivated) return null;
    const isLoading = loadingAction === member.id;
    return (
      <button
        onClick={() => handleResendInvite(member.id, fullName)}
        disabled={isLoading}
        aria-label={`Resend invite to ${fullName}`}
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {isLoading ? "Sending…" : "Resend Invite"}
      </button>
    );
  }

  /**
   * Renders the Edit Bio button for instructors and super admins.
   * Both roles can appear on the /about page.
   * @param member - The staff member row.
   */
  function renderEditBioButton(member: StaffMember) {
    if (member.role !== "instructor" && member.role !== "super_admin") return null;
    return (
      <button
        onClick={() => onEditBio(member)}
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
      >
        Edit Bio
      </button>
    );
  }

  /**
   * Renders an inline email + phone edit form for a staff member.
   * Shows an "Edit Contact" trigger link when closed; expands to input fields on click.
   * Closing any other open inline panel is handled by openEditContact().
   * @param member - The staff member row.
   * @param fullName - Full display name used in success messages.
   */
  function renderEditContactUI(member: StaffMember, fullName: string) {
    const isOpen = editingContactFor === member.id;
    const isLoading = loadingAction === member.id;

    if (isOpen) {
      return (
        <div className="w-full p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                First Name
              </label>
              <input
                type="text"
                value={firstNameDraft}
                onChange={(e) => setFirstNameDraft(e.target.value)}
                disabled={isLoading}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                Last Name
              </label>
              <input
                type="text"
                value={lastNameDraft}
                onChange={(e) => setLastNameDraft(e.target.value)}
                disabled={isLoading}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-0.5">
              Email
            </label>
            <input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              disabled={isLoading}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-0.5">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              required
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="(555) 555-5555"
              disabled={isLoading}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleUpdateContact(member.id, fullName)}
              disabled={isLoading || !firstNameDraft.trim() || !lastNameDraft.trim() || !emailDraft.trim() || !phoneDraft.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditingContactFor(null)}
              disabled={isLoading}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        onClick={() =>
          openEditContact(member.id, member.first_name, member.last_name, member.email, member.phone ?? null)
        }
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 transition-colors"
      >
        Edit Contact
      </button>
    );
  }

  /**
   * Renders a delete confirmation UI for a staff member.
   * Shows a "Delete" trigger link when closed; expands to a destructive confirmation.
   * The API route will block deletion if the member has class sessions on record.
   * Not rendered for owner rows or the current user's own row — guarded in the caller.
   * @param member - The staff member row.
   * @param fullName - Full display name shown in the confirmation warning.
   */
  function renderDeleteUI(member: StaffMember, fullName: string) {
    const isOpen = deletingFor === member.id;
    const isLoading = loadingAction === member.id;

    if (isOpen) {
      return (
        <div className="w-full p-3 bg-red-50 border border-red-200 rounded-lg space-y-1.5">
          <p className="text-xs text-red-800 font-medium leading-snug">
            Permanently delete {fullName}? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDelete(member.id, fullName)}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Deleting…" : "Delete Permanently"}
            </button>
            <button
              onClick={() => setDeletingFor(null)}
              disabled={isLoading}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        onClick={() => {
          setDeletingFor(member.id);
          setChangingRoleFor(null);
          setDeactivatingFor(null);
          setEditingContactFor(null);
        }}
        aria-label={`Delete ${fullName}`}
        className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border bg-white text-red-500 border-red-200 hover:bg-red-50 transition-colors"
      >
        Delete
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
                    {/* Edit Bio is available to everyone who can appear on /about.
                        Role and deactivate actions are hidden for the owner.
                        Delete is also hidden for the current logged-in user. */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {renderEditBioButton(member)}
                      {!isOwner && renderEditContactUI(member, fullName)}
                      {!isOwner && renderResendInviteButton(member, fullName)}
                      {!isOwner && renderChangeRoleUI(member, fullName)}
                      {!isOwner && renderDeactivateUI(member, fullName)}
                      {!isOwner && member.id !== currentUserId && renderDeleteUI(member, fullName)}
                    </div>
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

              {/* Action buttons — Edit Bio available to all; role/deactivate/delete hidden for owner */}
              <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-1.5 items-center">
                {renderEditBioButton(member)}
                {!isOwner && renderEditContactUI(member, fullName)}
                {!isOwner && renderResendInviteButton(member, fullName)}
                {!isOwner && renderChangeRoleUI(member, fullName)}
                {!isOwner && renderDeactivateUI(member, fullName)}
                {!isOwner && member.id !== currentUserId && renderDeleteUI(member, fullName)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default StaffList;

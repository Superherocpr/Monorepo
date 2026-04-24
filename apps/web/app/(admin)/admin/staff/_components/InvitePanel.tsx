"use client";

/**
 * InvitePanel component
 * Slide-in panel from the right for inviting new staff members.
 * Sends a POST to /api/staff/invite which creates the Supabase auth account,
 * inserts the profile with the assigned role, and emails a password setup link.
 * Super Admin is excluded from the role dropdown — must be promoted manually after creation.
 * Used by: StaffManagement
 */

import React, { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface InvitePanelProps {
  open: boolean;
  /** Called when the panel should close (cancel or Escape key). */
  onClose: () => void;
  /** Called with the invited email address on successful invite. */
  onSuccess: (email: string) => void;
  /** Called with an error message if the invite request fails. */
  onError: (message: string) => void;
}

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 " +
  "focus:border-transparent";

/**
 * Slide-in invite panel for creating new staff accounts.
 * Traps keyboard focus while open and closes on Escape.
 * @param open - Whether the panel is visible.
 * @param onClose - Called when the panel should be dismissed.
 * @param onSuccess - Called with the invited email on a successful response.
 * @param onError - Called with an error message on failure.
 */
const InvitePanel: React.FC<InvitePanelProps> = ({
  open,
  onClose,
  onSuccess,
  onError,
}) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("instructor");
  const [personalMessage, setPersonalMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus to the first input when the panel opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => firstInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Trap focus inside the panel and close on Escape
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  /** Resets all form fields to their default state. */
  function resetForm() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setRole("instructor");
    setPersonalMessage("");
  }

  /**
   * Submits the invite form to POST /api/staff/invite.
   * On success calls onSuccess with the invited email; on failure calls onError.
   * @param e - The form submit event.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, role, personalMessage }),
      });
      const data: { success: boolean; error?: string } = await res.json();
      if (!res.ok || !data.success) {
        onError(data.error ?? "Failed to send invitation.");
      } else {
        resetForm();
        onSuccess(email);
      }
    } catch {
      onError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Overlay — click to close */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Invite Staff Member"
        className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white border-l border-gray-200 z-50 overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">Invite Staff Member</h2>
          <button
            onClick={onClose}
            aria-label="Close invite panel"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="px-6 py-6 space-y-5 flex-1">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  First Name <span className="text-red-600">*</span>
                </label>
                <input
                  ref={firstInputRef}
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                  placeholder="Jane"
                  required
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Last Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                  placeholder="Smith"
                  required
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Email Address <span className="text-red-600">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="jane@example.com"
                required
                autoComplete="off"
              />
            </div>

            {/* Role — Super Admin intentionally excluded */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Role <span className="text-red-600">*</span>
              </label>
              {/*
               * Super Admin is not available here — staff can only be promoted to
               * Super Admin manually after their account is created.
               */}
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputClass}
                required
              >
                <option value="instructor">Instructor</option>
                <option value="manager">Manager</option>
                <option value="inspector">Inspector</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Super Admin must be promoted manually after the account is created.
              </p>
            </div>

            {/* Personal message */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Personal Message{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={personalMessage}
                onChange={(e) => setPersonalMessage(e.target.value)}
                className={`${inputClass} resize-none`}
                rows={3}
                placeholder="Add a personal note to include in the invitation email…"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              {submitting ? "Sending…" : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default InvitePanel;

"use client";

/**
 * ViewAsSwitcher — dropdown letting a Super Admin switch their effective role
 * to Manager, Instructor, or Inspector (or back). Rendered by AdminTopBar only
 * when the user's REAL role is super_admin; the server actions re-verify that
 * regardless. Used by: app/(admin)/_components/AdminTopBar.tsx.
 */

import { useState, useRef, useEffect, useTransition } from "react";
import {
  VIEW_AS_ROLES,
  type ViewAsRole,
} from "@/lib/auth/effective-role";
import { setViewAsRole, clearViewAsRole } from "@/lib/auth/view-as-actions";
import { ROLE_LABELS } from "./role-badges";
import type { UserRole } from "@/types/users";

interface ViewAsSwitcherProps {
  /** The role currently being viewed (effective role). */
  effectiveRole: UserRole;
  /** Whether a view-as session is currently active. */
  isViewingAs: boolean;
}

/** Dropdown to enter/exit a view-as session. Only mounted for real super admins. */
export default function ViewAsSwitcher({
  effectiveRole,
  isViewingAs,
}: ViewAsSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  /**
   * Switches the effective role. The server action sets the cookie and
   * redirects to /admin; errors are logged but not surfaced inline since the
   * only realistic failure is a stale session (next navigation re-guards).
   */
  function handleSelect(role: ViewAsRole | "super_admin") {
    setOpen(false);
    startTransition(async () => {
      const result =
        role === "super_admin"
          ? await clearViewAsRole()
          : await setViewAsRole(role);
      if (result?.error) console.error("View-as switch failed:", result.error);
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors duration-100 disabled:opacity-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        View as
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50"
        >
          {VIEW_AS_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(role)}
              disabled={effectiveRole === role}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400"
            >
              {ROLE_LABELS[role]}
              {effectiveRole === role && " ✓"}
            </button>
          ))}
          {isViewingAs && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                type="button"
                role="menuitem"
                onClick={() => handleSelect("super_admin")}
                className="w-full text-left px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Exit to Super Admin
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

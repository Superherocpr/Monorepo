"use client";

/**
 * ViewAsBanner — persistent bar shown while a Super Admin is viewing the admin
 * area as a lower role. Provides an always-available Exit button (the caller's
 * REAL role is super_admin whenever this renders, so exiting is always allowed).
 * Used by: app/(admin)/layout.tsx.
 */

import { useTransition } from "react";
import { clearViewAsRole } from "@/lib/auth/view-as-actions";
import { ROLE_LABELS } from "./role-badges";
import type { UserRole } from "@/types/users";

interface ViewAsBannerProps {
  /** The downgraded role currently being viewed. */
  effectiveRole: UserRole;
}

/** Amber banner: "Viewing as X — Exit". Rendered only while view-as is active. */
export default function ViewAsBanner({ effectiveRole }: ViewAsBannerProps) {
  const [isPending, startTransition] = useTransition();

  /** Exits view-as via the server action (deletes cookie, redirects to /admin). */
  function handleExit() {
    startTransition(async () => {
      const result = await clearViewAsRole();
      if (result?.error) console.error("Exit view-as failed:", result.error);
    });
  }

  return (
    <div className="bg-purple-50 border-b border-purple-200 px-6 py-2 flex items-center justify-between gap-4">
      <p className="text-sm text-purple-800 font-medium">
        Viewing as {ROLE_LABELS[effectiveRole]} — you&apos;re seeing the admin
        area with that role&apos;s permissions.
      </p>
      <button
        type="button"
        onClick={handleExit}
        disabled={isPending}
        className="shrink-0 text-sm font-semibold text-purple-900 hover:text-purple-700 underline underline-offset-2 transition-colors disabled:opacity-50"
      >
        {isPending ? "Exiting…" : "Exit to Super Admin"}
      </button>
    </div>
  );
}

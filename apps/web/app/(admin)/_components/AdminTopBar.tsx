"use client";

/**
 * AdminTopBar — top navigation bar for the admin area.
 * Shows the current user's name, role badge, a "View as" switcher for real
 * super admins, and a sign-out button. The badge reflects the EFFECTIVE role
 * (with a "viewing" marker while view-as is active).
 * Used by: app/(admin)/layout.tsx
 */

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/users";
import { ROLE_LABELS, ROLE_COLORS } from "./role-badges";
import ViewAsSwitcher from "./ViewAsSwitcher";

interface AdminTopBarProps {
  firstName: string;
  lastName: string;
  /** The user's real role from profiles.role. */
  realRole: UserRole;
  /** The role currently in effect (differs from realRole during view-as). */
  effectiveRole: UserRole;
  /** True while a super admin is viewing as a lower role. */
  isViewingAs: boolean;
}

/** Top bar with user identity, role badge, view-as switcher, and sign-out. */
export default function AdminTopBar({
  firstName,
  lastName,
  realRole,
  effectiveRole,
  isViewingAs,
}: AdminTopBarProps) {
  const router = useRouter();

  /**
   * Signs the user out via the Supabase client and redirects to sign-in.
   */
  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/signin");
  }

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      {/* Left: spacer on desktop (sidebar takes this space), page title placeholder on mobile */}
      <div className="lg:hidden w-10" aria-hidden="true" />

      {/* Right: user info + view-as + sign out */}
      <div className="flex items-center gap-4 ml-auto">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {firstName} {lastName}
          </span>
          <span
            className={[
              "text-xs font-semibold px-2 py-0.5 rounded-full",
              ROLE_COLORS[effectiveRole],
              // Dashed ring marks a temporary view-as badge vs. a real role.
              isViewingAs ? "ring-1 ring-dashed ring-current" : "",
            ].join(" ")}
          >
            {ROLE_LABELS[effectiveRole]}
            {isViewingAs && " (viewing)"}
          </span>
        </div>

        {/* Only real super admins ever see the switcher; server actions re-verify. */}
        {realRole === "super_admin" && (
          <ViewAsSwitcher
            effectiveRole={effectiveRole}
            isViewingAs={isViewingAs}
          />
        )}

        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors duration-100"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

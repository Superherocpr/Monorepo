"use client";

/**
 * AdminTopBar — top navigation bar for the admin area.
 * Shows the current user's name, role badge, and a sign-out button.
 * Used by: app/(admin)/layout.tsx
 */

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/users";

/** Human-readable labels for each staff role. */
const ROLE_LABELS: Record<UserRole, string> = {
  customer: "Customer",
  instructor: "Instructor",
  manager: "Manager",
  super_admin: "Super Admin",
  inspector: "Inspector",
};

/** Tailwind color classes for each role badge. */
const ROLE_COLORS: Record<UserRole, string> = {
  customer: "bg-gray-100 text-gray-600",
  instructor: "bg-blue-100 text-blue-700",
  manager: "bg-amber-100 text-amber-700",
  super_admin: "bg-red-100 text-red-700",
  inspector: "bg-green-100 text-green-700",
};

interface AdminTopBarProps {
  firstName: string;
  lastName: string;
  role: UserRole;
}

/** Top bar with user identity, role badge, and sign-out for the admin area. */
export default function AdminTopBar({
  firstName,
  lastName,
  role,
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

      {/* Right: user info + sign out */}
      <div className="flex items-center gap-4 ml-auto">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {firstName} {lastName}
          </span>
          <span
            className={[
              "text-xs font-semibold px-2 py-0.5 rounded-full",
              ROLE_COLORS[role],
            ].join(" ")}
          >
            {ROLE_LABELS[role]}
          </span>
        </div>

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

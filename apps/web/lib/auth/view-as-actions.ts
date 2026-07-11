"use server";

/**
 * Server actions for the Super Admin "View As" role switcher.
 * setViewAsRole / clearViewAsRole manage the httpOnly `admin-view-as` cookie.
 * Both re-verify the caller's REAL role is super_admin before touching the
 * cookie, so no other role can activate view-as. Side effects: sets/deletes
 * the cookie and redirects to /admin for a full re-render under the new role.
 * Used by: app/(admin)/_components/ViewAsSwitcher.tsx and ViewAsBanner.tsx.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  VIEW_AS_COOKIE,
  VIEW_AS_ROLES,
  type ViewAsRole,
} from "@/lib/auth/effective-role";

/** View-as cookie lifetime: 8 hours, so a forgotten switch self-expires. */
const VIEW_AS_MAX_AGE_SECONDS = 60 * 60 * 8;

/**
 * Verifies the current session belongs to an active (not archived/deactivated)
 * super admin, checking the REAL profiles.role — never the view-as cookie.
 * @returns true if the caller is a real super admin.
 */
async function isRealSuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const admin = await createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, archived, deactivated")
    .eq("id", user.id)
    .single();

  return (
    !!profile &&
    profile.role === "super_admin" &&
    !profile.archived &&
    !profile.deactivated
  );
}

/**
 * Activates view-as: stores the requested role in the httpOnly cookie.
 * Rejects unless the caller's real role is super_admin and the role is in
 * VIEW_AS_ROLES. On success, redirects to /admin (never returns).
 * @param role - The role to view as (manager | instructor | inspector).
 * @returns `{ error }` only on failure; success redirects.
 */
export async function setViewAsRole(
  role: ViewAsRole
): Promise<{ error: string | null }> {
  if (!(VIEW_AS_ROLES as readonly string[]).includes(role)) {
    return { error: "Invalid role" };
  }
  if (!(await isRealSuperAdmin())) {
    return { error: "Forbidden" };
  }

  const cookieStore = await cookies();
  cookieStore.set(VIEW_AS_COOKIE, role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VIEW_AS_MAX_AGE_SECONDS,
  });

  redirect("/admin");
}

/**
 * Exits view-as: deletes the cookie and restores the real super_admin view.
 * Allowed whenever the caller's REAL role is super_admin — works while the
 * effective role is downgraded. On success, redirects to /admin (never returns).
 * @returns `{ error }` only on failure; success redirects.
 */
export async function clearViewAsRole(): Promise<{ error: string | null }> {
  if (!(await isRealSuperAdmin())) {
    return { error: "Forbidden" };
  }

  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_COOKIE);

  redirect("/admin");
}

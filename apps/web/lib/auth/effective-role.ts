/**
 * Shared admin authentication + "View As" effective-role resolution.
 *
 * Super Admins can temporarily downgrade their view to manager, instructor,
 * or inspector via the `admin-view-as` cookie (set by lib/auth/view-as-actions.ts).
 * The cookie is ONLY honored when the caller's real DB role is super_admin and
 * its value is in VIEW_AS_ROLES — so a forged cookie can only ever lower
 * privileges, never raise them.
 *
 * NOTE: View-as is an application-layer concept only. RLS policies and DB RPCs
 * keep checking the REAL role as defense-in-depth. Consequence: anon-client
 * queries evaluated under RLS may return slightly broader data to a downgraded
 * super admin than a real instructor would see — never less.
 *
 * Used by: app/(admin)/layout.tsx, admin page guards, and API routes via
 * requireApiRole().
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
// Client-safe constants are defined in view-as-constants.ts and imported here
// for internal use, then re-exported so that server code has a single import
// path while client components can import from view-as-constants.ts directly
// (without transitively pulling in next/headers).
import {
  VIEW_AS_COOKIE,
  VIEW_AS_ROLES,
  STAFF_ROLES,
  type ViewAsRole,
} from "@/lib/auth/view-as-constants";
export { VIEW_AS_COOKIE, VIEW_AS_ROLES, STAFF_ROLES };
export type { ViewAsRole };

/** Profile columns loaded for every admin request. */
export interface AdminActorProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  archived: boolean;
  deactivated: boolean;
}

/** The authenticated admin-area user with both real and effective roles resolved. */
export interface AdminActor {
  /** Supabase auth user. */
  user: User;
  /** Profile row (subset) for the user. */
  profile: AdminActorProfile;
  /** Role from profiles.role — the only trusted source of authority. */
  realRole: UserRole;
  /** realRole, unless realRole is super_admin AND a valid view-as cookie is set. */
  effectiveRole: UserRole;
  /** True when a super admin is currently viewing as a lower role. */
  isViewingAs: boolean;
}

/**
 * Resolves the effective role from the real role and the raw view-as cookie value.
 * Pure function — the cookie can only LOWER privileges: it is ignored unless the
 * real role is super_admin and the value is one of VIEW_AS_ROLES.
 * @param realRole - The trusted role from profiles.role.
 * @param cookieValue - Raw `admin-view-as` cookie value, or undefined if unset.
 * @returns The role the user should be treated as for this request.
 */
export function resolveEffectiveRole(
  realRole: UserRole,
  cookieValue: string | undefined
): UserRole {
  if (realRole !== "super_admin") return realRole;
  if (!cookieValue) return realRole;
  if (!(VIEW_AS_ROLES as readonly string[]).includes(cookieValue)) {
    return realRole;
  }
  return cookieValue as ViewAsRole;
}

/**
 * Loads the authenticated admin actor for the current request.
 * Fetches the auth user, their profile (via service-role client, matching the
 * existing admin layout pattern), and resolves the effective role from the
 * view-as cookie.
 * @returns The AdminActor, or null if unauthenticated, profile missing,
 *          archived, deactivated, or not a staff role. Callers redirect on null.
 */
export async function getAdminActor(): Promise<AdminActor | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = await createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, first_name, last_name, role, archived, deactivated")
    .eq("id", user.id)
    .single();

  // Archived/deactivated staff are bounced even with a live session (THREAT-018).
  if (
    !profile ||
    profile.archived ||
    profile.deactivated ||
    !STAFF_ROLES.includes(profile.role as UserRole)
  ) {
    return null;
  }

  const realRole = profile.role as UserRole;
  const cookieStore = await cookies();
  const effectiveRole = resolveEffectiveRole(
    realRole,
    cookieStore.get(VIEW_AS_COOKIE)?.value
  );

  return {
    user,
    profile: profile as AdminActorProfile,
    realRole,
    effectiveRole,
    isViewingAs: effectiveRole !== realRole,
  };
}

/**
 * Auth guard for API routes. Loads the admin actor and checks the EFFECTIVE
 * role against the route's allowlist, so a super admin viewing as a lower role
 * is genuinely denied super-admin-only actions.
 * @param allowed - Roles permitted to call the route.
 * @returns `{ actor }` on success, or `{ error }` holding a ready-to-return
 *          NextResponse (401 unauthenticated, 403 insufficient role).
 */
export async function requireApiRole(
  allowed: UserRole[]
): Promise<{ actor: AdminActor } | { error: NextResponse }> {
  const actor = await getAdminActor();
  if (!actor) {
    return {
      error: NextResponse.json(
        { data: null, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (!allowed.includes(actor.effectiveRole)) {
    return {
      error: NextResponse.json(
        { data: null, error: "Forbidden" },
        { status: 403 }
      ),
    };
  }
  return { actor };
}

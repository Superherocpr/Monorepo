/**
 * Admin Feature Reference
 * Route: /admin/reference
 * Called by: Admin Settings page (all staff roles), admin nav.
 * Auth: instructor, manager, and super_admin — content filtered to each role's accessible features.
 * Inspectors are redirected to /admin.
 */

import { redirect } from "next/navigation";
import { getAdminActor } from "@/lib/auth/effective-role";
import ReferenceContent from "./_components/ReferenceContent";

export const metadata = { title: "Admin Reference" };

const ALLOWED_ROLES = ["instructor", "manager", "super_admin"] as const;

/**
 * Server component entry point for /admin/reference.
 * Allows instructor, manager, and super_admin roles. Passes the effective role
 * to ReferenceContent so it can filter sections down to what the user can access.
 */
export default async function AdminReferencePage(): Promise<React.ReactElement> {
  const actor = await getAdminActor();

  if (
    !actor ||
    !(ALLOWED_ROLES as readonly string[]).includes(actor.effectiveRole)
  ) {
    redirect("/admin");
  }

  return <ReferenceContent userRole={actor.effectiveRole} />;
}

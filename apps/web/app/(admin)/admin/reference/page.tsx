/**
 * Admin Feature Reference
 * Route: /admin/reference
 * Called by: Admin Settings page (General tab), super admin only.
 * Auth gate only — all content and search logic lives in ReferenceContent.
 */

import { redirect } from "next/navigation";
import { getAdminActor } from "@/lib/auth/effective-role";
import ReferenceContent from "./_components/ReferenceContent";

export const metadata = { title: "Admin Reference" };

/**
 * Server component entry point for /admin/reference.
 * Enforces super_admin gate (honors view-as) and delegates rendering to ReferenceContent.
 */
export default async function AdminReferencePage(): Promise<React.ReactElement> {
  const actor = await getAdminActor();
  if (!actor || actor.effectiveRole !== "super_admin") redirect("/admin");

  return <ReferenceContent />;
}

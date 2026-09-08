/**
 * /admin/profile/payment: Instructor payout settings page.
 * Server component: fetches the logged-in instructor's PayPal payout email.
 * Access: instructor and super_admin only.
 * Used by: AdminSidebar "Payout Settings" link.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { getInstructorEarningsData } from "@/lib/payout-dashboard";
import type { Metadata } from "next";
import type { UserRole } from "@/types/users";
import PayoutSettingsClient from "./_components/PayoutSettingsClient";
import InstructorEarningsPanel from "./_components/InstructorEarningsPanel";

export const metadata: Metadata = {
  title: "Payout Settings | SuperHeroCPR Admin",
};

/** Roles that may access this page. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Fetches and renders the payout settings page.
 * Redirects to /admin unless the effective role is instructor or super_admin.
 */
export default async function PaymentAccountPage() {
  const actor = await getAdminActor();
  if (!actor || !ALLOWED_ROLES.includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  // paypal_payout_email isn't part of the shared actor profile: fetch it here.
  const admin = await createAdminClient();
  const [{ data: profile }, earningsData] = await Promise.all([
    admin
      .from("profiles")
      .select("paypal_payout_email")
      .eq("id", actor.user.id)
      .single(),
    getInstructorEarningsData(admin, actor.user.id),
  ]);

  return (
    <div className="space-y-12 px-1">
      <PayoutSettingsClient
        initialPaypalPayoutEmail={profile?.paypal_payout_email ?? null}
      />
      <div className="mx-auto max-w-5xl">
        <InstructorEarningsPanel data={earningsData} />
      </div>
    </div>
  );
}

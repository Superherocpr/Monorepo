/**
 * /admin/profile/payment — Instructor payout settings page.
 * Server component: fetches the logged-in instructor's PayPal payout email.
 * Access: instructor and super_admin only.
 * Used by: AdminSidebar "Payout Settings" link.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import type { UserRole } from "@/types/users";
import PayoutSettingsClient from "./_components/PayoutSettingsClient";

export const metadata: Metadata = {
  title: "Payout Settings | SuperHeroCPR Admin",
};

/** Roles that may access this page. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Fetches and renders the payout settings page.
 * Redirects to /admin if the user's role is not instructor or super_admin.
 */
export default async function PaymentAccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?redirect=/admin/profile/payment");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, paypal_payout_email")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  return (
    <PayoutSettingsClient
      initialPaypalPayoutEmail={profile.paypal_payout_email ?? null}
    />
  );
}

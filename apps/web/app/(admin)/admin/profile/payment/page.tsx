/**
 * /admin/profile/payment — Instructor Payment Account page.
 * Server component: fetches the logged-in instructor's connected payment accounts.
 * Access: instructor and super_admin only.
 * Used by: AdminSidebar "Payment Account" link.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import type { UserRole, PaymentPlatform } from "@/types/users";
import PaymentAccountClient from "./_components/PaymentAccountClient";

export const metadata: Metadata = {
  title: "Payment Account | Superhero CPR Admin",
};

/** Shape of a connected payment account returned to the client — no tokens. */
export interface ConnectedAccount {
  id: string;
  platform: PaymentPlatform;
  platform_account_id: string | null;
  is_active: boolean;
  connected_at: string;
}

/** Roles that may access this page. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Fetches and renders the payment account management page.
 * Redirects to /admin if the user's role is not instructor or super_admin.
 */
export default async function PaymentAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { connected } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?redirect=/admin/profile/payment");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/admin");
  }

  // Fetch connected accounts — no tokens, just the public fields
  const { data: accounts } = await supabase
    .from("instructor_payment_accounts")
    .select("id, platform, platform_account_id, is_active, connected_at")
    .eq("instructor_id", profile.id)
    .order("connected_at", { ascending: false });

  return (
    <PaymentAccountClient
      instructorId={profile.id}
      initialAccounts={(accounts ?? []) as ConnectedAccount[]}
      connectedParam={connected ?? null}
    />
  );
}

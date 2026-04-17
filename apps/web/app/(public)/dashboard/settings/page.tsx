/**
 * /dashboard/settings — Account settings page.
 * Thin server wrapper: fetches the customer's profile and passes it to SettingsClient.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsPageHeader from "./_components/SettingsPageHeader";
import SettingsClient from "./_components/SettingsClient";

export const metadata = {
  title: "Account Settings | Superhero CPR",
};

/** Fetches the customer's profile and renders the interactive settings form. */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/book/signin?redirect=/dashboard/settings");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email, phone, address, city, state, zip")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/book/signin?redirect=/dashboard/settings");

  return (
    <div>
      <SettingsPageHeader />
      <SettingsClient profile={profile} userId={user.id} />
    </div>
  );
}

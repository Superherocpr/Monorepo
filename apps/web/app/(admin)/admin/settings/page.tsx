/**
 * Admin Settings Page
 * Route: /admin/settings
 * Called by: Admin sidebar nav (super_admin only)
 * Auth: super_admin only — all other roles are redirected to /admin
 * Fetches class types and preset grades server-side, then passes them to
 * SettingsClient which owns all interactive state and mutations.
 * Checks Zoho connection status from system_settings.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/zoho";
import SettingsClient from "./_components/SettingsClient";
import type { UserRole } from "@/types/users";

export const metadata = { title: "Settings" };

/** A class type row from the class_types table. */
export interface ClassType {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  max_capacity: number;
  price: number;
  active: boolean;
}

/** A preset grade row from the preset_grades table. */
export interface PresetGrade {
  id: string;
  value: number;
  label: string;
}

/**
 * Server component — fetches settings data and passes it to SettingsClient.
 * Redirects non-super-admins to /admin.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/settings");

  // Role check — super admin only
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role as UserRole) !== "super_admin") {
    redirect("/admin");
  }

  // Fetch class types and preset grades in parallel
  const [{ data: classTypes }, { data: presetGrades }] = await Promise.all([
    supabase
      .from("class_types")
      .select("id, name, description, duration_minutes, max_capacity, price, active")
      .order("name"),
    supabase
      .from("preset_grades")
      .select("id, value, label")
      .order("value"),
  ]);

  // Check Zoho connection status — account ID is only set when connected
  const zohoAccountId = await getSetting("zoho_account_id");
  const zohoEmail = await getSetting("zoho_connected_email");

  const params = await searchParams;
  const zohoParam = params.zoho ?? null;

  return (
    <SettingsClient
      classTypes={(classTypes ?? []) as ClassType[]}
      presetGrades={(presetGrades ?? []) as PresetGrade[]}
      zohoConnected={Boolean(zohoAccountId)}
      zohoEmail={zohoEmail}
      zohoParam={zohoParam}
    />
  );
}

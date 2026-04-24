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

/** An instructor row used by the Instructor Payment Routing section. */
export interface InstructorRoutingRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  payment_routing: "instructor" | "business";
  /** True if the instructor has at least one active PayPal account connected. */
  has_active_paypal: boolean;
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

  // Fetch class types, preset grades, and instructor routing data in parallel
  const [{ data: classTypes }, { data: presetGrades }, { data: instructorRows }] = await Promise.all([
    supabase
      .from("class_types")
      .select("id, name, description, duration_minutes, max_capacity, price, active")
      .order("name"),
    supabase
      .from("preset_grades")
      .select("id, value, label")
      .order("value"),
    // super_admin profiles also instruct — include them so their routing can be set
    supabase
      .from("profiles")
      .select(
        "id, first_name, last_name, email, payment_routing, role, instructor_payment_accounts ( platform, is_active )"
      )
      .in("role", ["instructor", "super_admin"])
      .eq("deactivated", false)
      .order("last_name"),
  ]);

  // Reduce the joined accounts to a single boolean per instructor for the UI
  const instructors: InstructorRoutingRow[] = (instructorRows ?? []).map((row) => {
    const accounts =
      (row.instructor_payment_accounts as { platform: string; is_active: boolean }[] | null) ?? [];
    const hasPayPal = accounts.some((a) => a.platform === "paypal" && a.is_active);
    return {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      payment_routing: (row.payment_routing as "instructor" | "business") ?? "instructor",
      has_active_paypal: hasPayPal,
    };
  });

  // Check Zoho connection status — account ID is only set when connected
  const zohoAccountId = await getSetting("zoho_account_id");
  const zohoEmail = await getSetting("zoho_connected_email");

  const params = await searchParams;
  const zohoParam = params.zoho ?? null;

  return (
    <SettingsClient
      classTypes={(classTypes ?? []) as ClassType[]}
      presetGrades={(presetGrades ?? []) as PresetGrade[]}
      instructors={instructors}
      zohoConnected={Boolean(zohoAccountId)}
      zohoEmail={zohoEmail}
      zohoParam={zohoParam}
    />
  );
}

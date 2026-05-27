/**
 * Admin Settings Page
 * Route: /admin/settings
 * Called by: Admin sidebar nav
 * Auth:
 *   - super_admin — full settings panel (class types, grades, Zoho, instructor routing, etc.)
 *   - instructor  — Enrollware bookmarklet section only
 * All other roles are redirected to /admin.
 * Fetches class types and preset grades server-side, then passes them to
 * SettingsClient which owns all interactive state and mutations.
 * Checks Zoho connection status from system_settings.
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/zoho";
import SettingsClient from "./_components/SettingsClient";
import BookmarkletSetup from "@/app/(admin)/admin/enrollware-tool/_components/BookmarkletSetup";
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

  // Role check — instructors see a restricted view, only super_admins see full settings
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role as UserRole | undefined;

  if (!role || !["instructor", "super_admin"].includes(role)) {
    redirect("/admin");
  }

  // ── Instructor view: bookmarklet section only ─────────────────────────────
  if (role === "instructor") {
    const admin = await createAdminClient();
    // maybeSingle avoids a PGRST116 error log for users without a key yet
    const { data: existingKey } = await admin
      .from("api_keys")
      .select("id")
      .eq("profile_id", user.id)
      .eq("label", "enrollware-bookmarklet")
      .maybeSingle();

    const siteUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-sm text-gray-500 mb-8">Manage your Enrollware integration.</p>

        <section>
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Enrollware Bookmarklet
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              A one-click tool that auto-fills new classes on Enrollware from
              your SuperheroCPR roster. Generate it once, save it to your
              browser&apos;s bookmarks bar, and click it whenever you&apos;re on
              an Enrollware class-edit page.
            </p>
          </div>
          <BookmarkletSetup hasExistingKey={existingKey !== null} siteUrl={siteUrl} />
        </section>
      </div>
    );
  }

  // ── Super admin view: full settings panel ────────────────────────────────

  // Fetch class types, preset grades, instructor routing, and bookmarklet status in parallel
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

  // Check Zoho connection status using the durable credentials needed to refresh.
  // Also read the legacy_site_enabled flag — controls which version of / renders.
  const [zohoAccountId, zohoRefreshToken, zohoEmail, legacySiteFlag] = await Promise.all([
    getSetting("zoho_account_id"),
    getSetting("zoho_refresh_token"),
    getSetting("zoho_connected_email"),
    getSetting("legacy_site_enabled"),
  ]);

  const params = await searchParams;
  const zohoParam = params.zoho ?? null;

  // Fetch the super admin's own bookmarklet key status so they can manage it
  // from settings just like instructors can.
  const adminClient = await createAdminClient();
  const { data: existingKey } = await adminClient
    .from("api_keys")
    .select("id")
    .eq("profile_id", user.id)
    .eq("label", "enrollware-bookmarklet")
    .maybeSingle();

  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  return (
    <SettingsClient
      classTypes={(classTypes ?? []) as ClassType[]}
      presetGrades={(presetGrades ?? []) as PresetGrade[]}
      instructors={instructors}
      zohoConnected={Boolean(zohoAccountId && zohoRefreshToken)}
      zohoEmail={zohoEmail}
      zohoParam={zohoParam}
      legacySiteEnabled={legacySiteFlag === "true"}
      isSuperAdmin
      enrollwareSlot={
        // key required: React 19 owner-based key tracking flags elements that are
        // created in one component (here) and rendered inside another (SettingsClient).
        <BookmarkletSetup key="enrollware-slot" hasExistingKey={existingKey !== null} siteUrl={siteUrl} />
      }
    />
  );
}

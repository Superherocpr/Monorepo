/**
 * Admin Settings Page
 * Route: /admin/settings
 * Called by: Admin sidebar nav
 * Auth:
 *   - super_admin — full settings panel (class types, grades, Zoho, locations, etc.)
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
import PayoutSettingsPanel from "./_components/PayoutSettingsPanel";
import BookmarkletSetup from "@/app/(admin)/admin/enrollware-tool/_components/BookmarkletSetup";
import LocationsClient, {
  type LocationWithCount,
} from "@/app/(admin)/_components/LocationsClient";
import type { UserRole } from "@/types/users";
import type { PayoutTrigger, PayoutSchedule } from "@/app/api/settings/payouts/route";

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
  /** FK to cert_types.id — nullable for non-certifying sessions. */
  cert_type_id: string | null;
}

/** A minimal cert type row used to populate the cert type dropdown in class type editing. */
export interface CertTypeOption {
  id: string;
  name: string;
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

  // Role check — instructors see a restricted view, only super_admins see full settings
  // Own-row lookup: safe with session client via profiles_auth_read_own RLS policy.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role as UserRole | undefined;

  if (!role || !["instructor", "manager", "super_admin"].includes(role)) {
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

  // Service-role client used for all data queries in manager and super_admin branches.
  // Defined here (after the instructor early-return) so it's in scope for both branches.
  const admin = await createAdminClient();

  // ── Manager view: locations panel only ───────────────────────────────────
  if (role === "manager") {
    const { data: raw } = await admin
      .from("locations")
      .select(
        `id, name, address, city, state, zip, notes, is_home_base, created_at,
         class_sessions ( starts_at )`
      )
      .order("is_home_base", { ascending: false })
      .order("name", { ascending: true });

    const locations: LocationWithCount[] = (raw ?? []).map((loc) => {
      const sessions = Array.isArray(loc.class_sessions) ? loc.class_sessions : [];
      const dates = sessions.map((s: { starts_at: string }) => new Date(s.starts_at).getTime());
      const lastUsedAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
      return {
        id: loc.id,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        zip: loc.zip,
        notes: loc.notes ?? null,
        is_home_base: loc.is_home_base,
        created_at: loc.created_at,
        sessionCount: sessions.length,
        last_used_at: lastUsedAt,
      };
    });

    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <LocationsClient initialLocations={locations} userRole="manager" />
      </div>
    );
  }

  // ── Super admin view: full settings panel ────────────────────────────────

  // Fetch class types, preset grades, bookmarklet status,
  // and locations in parallel
  const [{ data: classTypes }, { data: certTypeRows }, { data: presetGrades }, { data: locationRaw }] = await Promise.all([
    admin
      .from("class_types")
      .select("id, name, description, duration_minutes, max_capacity, price, active, cert_type_id")
      .order("name"),
    // Cert types used to populate the linked cert dropdown in the class type add/edit panel.
    // Fetched separately from the certifications page so settings page is self-contained.
    admin
      .from("cert_types")
      .select("id, name")
      .eq("active", true)
      .order("name"),
    admin
      .from("preset_grades")
      .select("id, value, label")
      .order("value"),
    admin
      .from("locations")
      .select(
        `id, name, address, city, state, zip, notes, is_home_base, created_at,
         class_sessions ( starts_at )`
      )
      .order("is_home_base", { ascending: false })
      .order("name", { ascending: true }),
  ]);

  // Map raw locations rows into the shape LocationsClient expects
  const locations: LocationWithCount[] = (locationRaw ?? []).map((loc) => {
    const sessions = Array.isArray(loc.class_sessions) ? loc.class_sessions : [];
    const dates = sessions.map((s: { starts_at: string }) => new Date(s.starts_at).getTime());
    const lastUsedAt = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
    return {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      notes: loc.notes ?? null,
      is_home_base: loc.is_home_base,
      created_at: loc.created_at,
      sessionCount: sessions.length,
      last_used_at: lastUsedAt,
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

  // Fetch payout settings (platform_fee_percent, payout_trigger, payout_schedule).
  // Defensive: if migration 0021 hasn't been applied yet, fall back to safe defaults
  // so the settings page still renders without erroring.
  let payoutFeePercent = 20;
  let payoutTrigger: PayoutTrigger = "manual";
  let payoutSchedule: PayoutSchedule = "daily";
  try {
    const { data: payoutRows } = await admin
      .from("system_settings")
      .select("key, value")
      .in("key", ["platform_fee_percent", "payout_trigger", "payout_schedule"]);
    const pm = new Map<string, string>(
      ((payoutRows ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value])
    );
    const rawFee = Number(pm.get("platform_fee_percent") ?? "20");
    payoutFeePercent = Number.isFinite(rawFee) ? Math.min(100, Math.max(0, rawFee)) : 20;
    const rawTrigger = pm.get("payout_trigger") ?? "manual";
    payoutTrigger = (["immediate", "scheduled", "manual"] as string[]).includes(rawTrigger)
      ? (rawTrigger as PayoutTrigger)
      : "manual";
    const rawSchedule = pm.get("payout_schedule") ?? "daily";
    payoutSchedule = (["daily", "weekly", "monthly"] as string[]).includes(rawSchedule)
      ? (rawSchedule as PayoutSchedule)
      : "daily";
  } catch {
    // Suppress — defaults above are safe
  }

  const params = await searchParams;
  const zohoParam = params.zoho ?? null;

  // Fetch the super admin's own bookmarklet key status so they can manage it
  // from settings just like instructors can.
  const { data: existingKey } = await admin
    .from("api_keys")
    .select("id")
    .eq("profile_id", user.id)
    .eq("label", "enrollware-bookmarklet")
    .maybeSingle();

  const siteUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  return (
    <SettingsClient
      classTypes={(classTypes ?? []) as ClassType[]}
      certTypeOptions={(certTypeRows ?? []) as CertTypeOption[]}
      presetGrades={(presetGrades ?? []) as PresetGrade[]}
      zohoConnected={Boolean(zohoAccountId && zohoRefreshToken)}
      zohoEmail={zohoEmail}
      zohoParam={zohoParam}
      legacySiteEnabled={legacySiteFlag === "true"}
      isSuperAdmin
      payoutsSlot={
        <PayoutSettingsPanel
          key="payouts-slot"
          initialFeePercent={payoutFeePercent}
          initialTrigger={payoutTrigger}
          initialSchedule={payoutSchedule}
        />
      }
      enrollwareSlot={
        // key required: React 19 owner-based key tracking flags elements that are
        // created in one component (here) and rendered inside another (SettingsClient).
        <BookmarkletSetup key="enrollware-slot" hasExistingKey={existingKey !== null} siteUrl={siteUrl} />
      }
      locationsSlot={
        <LocationsClient key="locations-slot" initialLocations={locations} userRole="super_admin" />
      }
    />
  );
}

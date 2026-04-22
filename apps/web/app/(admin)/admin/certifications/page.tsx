/**
 * Admin Certifications page — `/admin/certifications`
 * Access: super_admin only.
 * Fetches all certifications (with customer, cert type, and session joins),
 * all cert types (with active flag), and the current reminders-paused setting,
 * then passes everything to CertificationsClient for tabbed display,
 * filtering, issue/edit/delete actions, and reminder management.
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import CertificationsClient from "@/app/(admin)/_components/CertificationsClient";
import type { CertificationAdminRecord, CertTypeAdminRow } from "@/types/certifications";

/** Server component — handles auth, data fetching, and data shaping. */
export default async function CertificationsPage() {
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Certifications management is super_admin only
  if (!profile || profile.role !== "super_admin") {
    redirect("/admin");
  }

  // ── Parallel data fetch ────────────────────────────────────────────────────
  // Use admin client for system_settings to bypass any RLS restrictions.
  const adminSupabase = await createAdminClient();

  const [certsResult, certTypesResult, remindersSetting] = await Promise.all([
    supabase
      .from("certifications")
      .select(`
        id, issued_at, expires_at, cert_number, notes, reminder_sent, session_id,
        profiles!customer_id ( id, first_name, last_name, email ),
        cert_types ( id, name, issuing_body, validity_months ),
        class_sessions (
          starts_at,
          class_types ( name )
        )
      `)
      .order("expires_at", { ascending: true }),

    supabase
      .from("cert_types")
      .select("id, name, description, validity_months, issuing_body, active")
      .order("name"),

    adminSupabase
      .from("system_settings")
      .select("value")
      .eq("key", "cert_reminders_paused")
      .maybeSingle(),
  ]);

  if (certsResult.error) {
    console.error("[CertificationsPage] Failed to fetch certifications", certsResult.error);
  }
  if (certTypesResult.error) {
    console.error("[CertificationsPage] Failed to fetch cert types", certTypesResult.error);
  }

  const rawCerts = (certsResult.data ?? []) as unknown as CertificationAdminRecord[];
  const remindersPaused = remindersSetting.data?.value === "true";

  // ── Build cert types with issue counts ────────────────────────────────────
  // Compute how many certifications exist per cert type from the already-fetched
  // certs array — avoids a separate aggregation query.
  const countByTypeId = rawCerts.reduce<Record<string, number>>((acc, cert) => {
    const typeId = cert.cert_types.id;
    acc[typeId] = (acc[typeId] ?? 0) + 1;
    return acc;
  }, {});

  const certTypes: CertTypeAdminRow[] = (certTypesResult.data ?? []).map((ct) => ({
    id: ct.id,
    name: ct.name,
    description: ct.description,
    validity_months: ct.validity_months,
    issuing_body: ct.issuing_body,
    active: ct.active,
    certCount: countByTypeId[ct.id] ?? 0,
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <CertificationsClient
        initialCerts={rawCerts}
        initialCertTypes={certTypes}
        remindersPaused={remindersPaused}
      />
    </main>
  );
}

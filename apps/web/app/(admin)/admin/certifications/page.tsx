/**
 * Admin Certifications page — `/admin/certifications`
 * Access: super_admin only.
 * Fetches all certifications (with customer, cert type, and session joins),
 * all cert types (with active flag), and the current reminders-paused setting,
 * then passes everything to CertificationsClient for tabbed display,
 * filtering, issue/edit/delete actions, and reminder management.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import CertificationsClient from "@/app/(admin)/_components/CertificationsClient";
import type { CertificationAdminRecord, CertTypeAdminRow } from "@/types/certifications";

/** Server component — handles auth, data fetching, and data shaping. */
export default async function CertificationsPage() {
  // Certifications management is super_admin only (honors view-as)
  const actor = await getAdminActor();
  if (!actor || actor.effectiveRole !== "super_admin") redirect("/admin");

  const admin = await createAdminClient();

  // ── Parallel data fetch ────────────────────────────────────────────────────
  // Use admin client for system_settings to bypass any RLS restrictions.
  const adminSupabase = await createAdminClient();

  const [certsResult, certTypesResult, classTypesResult, remindersSetting] = await Promise.all([
    admin
      .from("certifications")
      .select(`
        id, issued_at, expires_at, cert_number, notes, last_reminder_sent_days, session_id,
        profiles!customer_id ( id, first_name, last_name, email ),
        cert_types ( id, name, issuing_body, validity_months ),
        class_sessions (
          starts_at,
          class_types ( name )
        )
      `)
      .order("expires_at", { ascending: true }),

    admin
      .from("cert_types")
      .select("id, name, description, validity_months, issuing_body, card_design, active")
      .order("name"),

    admin
      .from("class_types")
      .select("id, name, description")
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

  // The client's reminder_sent badge only cares whether the cert has been
  // emailed for any 90/60/30/7-day milestone yet, not which one.
  type RawCertRow = Omit<CertificationAdminRecord, "reminder_sent"> & {
    last_reminder_sent_days: number | null;
  };
  const rawRows = (certsResult.data ?? []) as unknown as RawCertRow[];
  const rawCerts: CertificationAdminRecord[] = rawRows.map(
    ({ last_reminder_sent_days, ...cert }) => ({
      ...cert,
      reminder_sent: last_reminder_sent_days !== null,
    })
  );
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
    card_design: ct.card_design ?? "aha",
    active: ct.active,
    certCount: countByTypeId[ct.id] ?? 0,
  }));

  // Class types for optional prefill in the Add/Edit Cert Type form
  const classTypes = (classTypesResult.data ?? []).map((ct) => ({
    id: ct.id,
    name: ct.name,
    description: ct.description ?? "",
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <CertificationsClient
        initialCerts={rawCerts}
        initialCertTypes={certTypes}
        initialClassTypes={classTypes}
        remindersPaused={remindersPaused}
      />
    </main>
  );
}

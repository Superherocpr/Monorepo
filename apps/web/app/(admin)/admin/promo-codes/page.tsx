/**
 * Admin Promo Codes Page — /admin/promo-codes
 * Auth: super_admin only.
 * Fetches all promo codes, upcoming sessions, and class types server-side,
 * then passes them to PromoCodesClient which handles create/edit/delete interactions.
 */

import { redirect } from "next/navigation";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAdminClient } from "@/lib/supabase/server";
import PromoCodesClient from "./_components/PromoCodesClient";
import type { PromoCodeRow } from "@/app/api/admin/promo-codes/route";
import { floatingNow } from "@/lib/business-time";

export const metadata = { title: "Promo Codes" };

/** Minimal session option for the individual-session picker. */
export interface SessionOption {
  id: string;
  label: string;
  startsAt: string;
}

/** Class type option for the class-type picker. */
export interface ClassTypeOption {
  id: string;
  name: string;
}

/**
 * Fetches promo codes, upcoming sessions, and class types, then renders PromoCodesClient.
 * Redirects non-super-admins to /admin.
 */
export default async function PromoCodesPage() {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) redirect("/admin");

  const supabase = await createAdminClient();

  const [
    { data: rawCodes },
    { data: rawSessions },
    { data: rawClassTypes },
  ] = await Promise.all([
    // All promo codes with both junction tables included
    supabase
      .from("promo_codes")
      .select(`
        id, code, discount_type, discount_value, expires_at, active, created_at, scope,
        promo_code_sessions(id, session_id),
        promo_code_class_types(id, class_type_id)
      `)
      .order("created_at", { ascending: false }),

    // Upcoming sessions for the session picker
    supabase
      .from("class_sessions")
      .select("id, starts_at, class_types(name), locations(name)")
      .gte("starts_at", floatingNow())
      .order("starts_at", { ascending: true }),

    // All active class types for the class-type picker
    supabase
      .from("class_types")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ]);

  const codes: PromoCodeRow[] = (rawCodes ?? []).map((row) => {
    const sessions = Array.isArray(row.promo_code_sessions)
      ? (row.promo_code_sessions as { id: string; session_id?: string }[])
      : [];
    const classTypes = Array.isArray(row.promo_code_class_types)
      ? (row.promo_code_class_types as { id: string; class_type_id?: string }[])
      : [];
    return {
      id: row.id,
      code: row.code,
      discount_type: row.discount_type as "fixed" | "percent" | "free",
      discount_value:
        typeof row.discount_value === "number"
          ? row.discount_value
          : parseFloat(String(row.discount_value)),
      expires_at: row.expires_at ?? null,
      active: row.active,
      created_at: row.created_at,
      scope: ((row.scope as string) ?? "session") as "all" | "session_type" | "session",
      session_ids: sessions.map((s) => s.session_id ?? s.id),
      class_type_ids: classTypes.map((ct) => ct.class_type_id ?? ct.id),
    };
  });

  const sessions: SessionOption[] = (rawSessions ?? []).map((s) => {
    const classType = Array.isArray(s.class_types) ? s.class_types[0] : s.class_types;
    const location = Array.isArray(s.locations) ? s.locations[0] : s.locations;
    const name = (classType as { name?: string } | null)?.name ?? "Class";
    const loc = (location as { name?: string } | null)?.name ?? "";
    const date = new Date(s.starts_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return {
      id: s.id,
      startsAt: s.starts_at,
      label: `${name}${loc ? ` — ${loc}` : ""} · ${date}`,
    };
  });

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []).map((ct) => ({
    id: ct.id,
    name: ct.name,
  }));

  return <PromoCodesClient initialCodes={codes} sessions={sessions} classTypes={classTypes} />;
}

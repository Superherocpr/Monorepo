/**
 * GET  /api/admin/promo-codes
 * POST /api/admin/promo-codes
 * Called by: admin promo codes management page.
 * Auth: super_admin only.
 *
 * GET  — returns all promo codes with their scope and linked IDs.
 * POST — creates a new promo code and associates it with the given scope targets.
 *
 * Scope:
 *   all          — valid for any session; no junction rows needed
 *   session_type — valid for sessions of the linked class_types
 *   session      — valid for the specific linked class_sessions
 */

import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAdminClient } from "@/lib/supabase/server";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

type PromoScope = "all" | "session_type" | "session";

/** Shape returned for each promo code in the list. */
export interface PromoCodeRow {
  id: string;
  code: string;
  discount_type: "fixed" | "percent" | "free";
  discount_value: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  scope: PromoScope;
  /** Populated when scope = 'session'. */
  session_ids: string[];
  /** Populated when scope = 'session_type'. */
  class_type_ids: string[];
}

/**
 * Lists all promo codes with their scope and linked target IDs.
 * @returns JSON { data: PromoCodeRow[], error: null } or { data: null, error: string }
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const supabase = await createAdminClient();

  const { data, error } = await supabase
    .from("promo_codes")
    .select(`
      id, code, discount_type, discount_value, expires_at, active, created_at, scope,
      promo_code_sessions(id, session_id),
      promo_code_class_types(id, class_type_id)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/promo-codes] List failed:", error);
    return NextResponse.json({ data: null, error: "Failed to load promo codes" }, { status: 500 });
  }

  const rows: PromoCodeRow[] = (data ?? []).map((row) => {
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
      scope: (row.scope as PromoScope) ?? "session",
      session_ids: sessions.map((s) => s.session_id ?? s.id),
      class_type_ids: classTypes.map((ct) => ct.class_type_id ?? ct.id),
    };
  });

  return NextResponse.json({ data: rows, error: null });
}

/**
 * Creates a new promo code and links it to the appropriate scope targets.
 * Codes are stored uppercased and trimmed for consistent validation.
 * @param request - JSON body with code, discount_type, discount_value, expires_at,
 *                  scope, and either session_ids or class_type_ids depending on scope.
 * @returns JSON { data: { id: string }, error: null } or { data: null, error: string }
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  const { code, discount_type, discount_value, expires_at, scope, session_ids, class_type_ids } = body;

  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ data: null, error: "Code is required" }, { status: 400 });
  }

  if (!["fixed", "percent", "free"].includes(discount_type as string)) {
    return NextResponse.json({ data: null, error: "Invalid discount type" }, { status: 400 });
  }

  if (!["all", "session_type", "session"].includes(scope as string)) {
    return NextResponse.json({ data: null, error: "Invalid scope" }, { status: 400 });
  }

  const numValue =
    discount_type === "free"
      ? 0
      : typeof discount_value === "number"
        ? discount_value
        : parseFloat(String(discount_value ?? "0"));

  if (!Number.isFinite(numValue) || numValue < 0) {
    return NextResponse.json({ data: null, error: "Invalid discount value" }, { status: 400 });
  }

  if (discount_type === "percent" && numValue > 100) {
    return NextResponse.json(
      { data: null, error: "Percent discount cannot exceed 100" },
      { status: 400 }
    );
  }

  // Validate junction targets based on scope
  if (scope === "session") {
    if (!Array.isArray(session_ids) || session_ids.length === 0) {
      return NextResponse.json(
        { data: null, error: "At least one session must be selected" },
        { status: 400 }
      );
    }
    if (!session_ids.every((id) => typeof id === "string")) {
      return NextResponse.json({ data: null, error: "Invalid session IDs" }, { status: 400 });
    }
  }

  if (scope === "session_type") {
    if (!Array.isArray(class_type_ids) || class_type_ids.length === 0) {
      return NextResponse.json(
        { data: null, error: "At least one class type must be selected" },
        { status: 400 }
      );
    }
    if (!class_type_ids.every((id) => typeof id === "string")) {
      return NextResponse.json({ data: null, error: "Invalid class type IDs" }, { status: 400 });
    }
  }

  const expiresAt =
    expires_at === null || expires_at === undefined
      ? null
      : typeof expires_at === "string" && expires_at.trim()
        ? expires_at.trim()
        : null;

  const supabase = await createAdminClient();

  const { data: promoRow, error: insertError } = await supabase
    .from("promo_codes")
    .insert({
      code: code.trim().toUpperCase(),
      discount_type,
      discount_value: numValue,
      expires_at: expiresAt,
      scope,
      created_by: auth.actor.user.id,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { data: null, error: "A promo code with that code already exists" },
        { status: 409 }
      );
    }
    console.error("[admin/promo-codes] Insert failed:", insertError);
    return NextResponse.json({ data: null, error: "Failed to create promo code" }, { status: 500 });
  }

  const promoId = (promoRow as { id: string }).id;

  // Insert junction rows based on scope
  if (scope === "session") {
    const sessionLinks = (session_ids as string[]).map((sid) => ({
      promo_code_id: promoId,
      session_id: sid,
    }));
    const { error: linkError } = await supabase.from("promo_code_sessions").insert(sessionLinks);
    if (linkError) {
      console.error("[admin/promo-codes] Session link insert failed:", linkError);
      await supabase.from("promo_codes").delete().eq("id", promoId);
      return NextResponse.json(
        { data: null, error: "Failed to link sessions to promo code" },
        { status: 500 }
      );
    }
  } else if (scope === "session_type") {
    const typeLinks = (class_type_ids as string[]).map((ctid) => ({
      promo_code_id: promoId,
      class_type_id: ctid,
    }));
    const { error: linkError } = await supabase.from("promo_code_class_types").insert(typeLinks);
    if (linkError) {
      console.error("[admin/promo-codes] Class type link insert failed:", linkError);
      await supabase.from("promo_codes").delete().eq("id", promoId);
      return NextResponse.json(
        { data: null, error: "Failed to link class types to promo code" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ data: { id: promoId }, error: null }, { status: 201 });
}

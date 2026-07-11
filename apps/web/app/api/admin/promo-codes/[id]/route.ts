/**
 * PATCH  /api/admin/promo-codes/[id]
 * DELETE /api/admin/promo-codes/[id]
 * Called by: admin promo codes management page.
 * Auth: super_admin only.
 *
 * PATCH  — updates code, discount_type, discount_value, expires_at, active, scope,
 *          and/or junction targets (session_ids or class_type_ids).
 *          When scope or junction targets are provided, all junction rows for the
 *          previous scope are cleared and replaced atomically.
 * DELETE — hard-deletes the promo code (cascade removes all junction rows).
 */

import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAdminClient } from "@/lib/supabase/server";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

type PromoScope = "all" | "session_type" | "session";

/**
 * Updates an existing promo code. Partial updates are supported — only provided
 * fields are changed. When scope or junction arrays are provided, all existing
 * junction rows across both tables are replaced.
 * @param request - JSON body with any subset of updatable fields
 * @param params  - Route params containing the promo code ID
 * @returns JSON { data: { id: string }, error: null } or { data: null, error: string }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  const supabase = await createAdminClient();

  // Build the scalar update payload from only the provided fields
  const update: Record<string, unknown> = {};

  if (typeof body.code === "string" && body.code.trim()) {
    update.code = body.code.trim().toUpperCase();
  }

  if (body.discount_type !== undefined) {
    if (!["fixed", "percent", "free"].includes(body.discount_type as string)) {
      return NextResponse.json({ data: null, error: "Invalid discount type" }, { status: 400 });
    }
    update.discount_type = body.discount_type;
  }

  if (body.discount_value !== undefined) {
    const isFree = body.discount_type === "free" || update.discount_type === "free";
    const numValue = isFree
      ? 0
      : typeof body.discount_value === "number"
        ? body.discount_value
        : parseFloat(String(body.discount_value));
    if (!Number.isFinite(numValue) || numValue < 0) {
      return NextResponse.json({ data: null, error: "Invalid discount value" }, { status: 400 });
    }
    update.discount_value = numValue;
  }

  if ("expires_at" in body) {
    update.expires_at =
      body.expires_at === null || body.expires_at === ""
        ? null
        : typeof body.expires_at === "string"
          ? body.expires_at.trim()
          : null;
  }

  if (typeof body.active === "boolean") {
    update.active = body.active;
  }

  if (body.scope !== undefined) {
    if (!["all", "session_type", "session"].includes(body.scope as string)) {
      return NextResponse.json({ data: null, error: "Invalid scope" }, { status: 400 });
    }
    update.scope = body.scope;
  }

  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabase
      .from("promo_codes")
      .update(update)
      .eq("id", id);

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          { data: null, error: "A promo code with that code already exists" },
          { status: 409 }
        );
      }
      console.error("[admin/promo-codes/[id]] Update failed:", updateError);
      return NextResponse.json(
        { data: null, error: "Failed to update promo code" },
        { status: 500 }
      );
    }
  }

  // Resolve the effective scope (post-update) to validate junction targets
  const effectiveScope: PromoScope =
    typeof body.scope === "string" && ["all", "session_type", "session"].includes(body.scope)
      ? (body.scope as PromoScope)
      : null!; // unknown — only replace junctions if scope or arrays were provided

  const replacingJunctions =
    body.scope !== undefined ||
    Array.isArray(body.session_ids) ||
    Array.isArray(body.class_type_ids);

  if (replacingJunctions) {
    // Wipe all existing junction rows for both tables before re-inserting
    const [{ error: delSessionErr }, { error: delTypeErr }] = await Promise.all([
      supabase.from("promo_code_sessions").delete().eq("promo_code_id", id),
      supabase.from("promo_code_class_types").delete().eq("promo_code_id", id),
    ]);

    if (delSessionErr || delTypeErr) {
      console.error("[admin/promo-codes/[id]] Junction delete failed:", delSessionErr ?? delTypeErr);
      return NextResponse.json(
        { data: null, error: "Failed to update scope targets" },
        { status: 500 }
      );
    }

    // Re-insert based on the resolved scope
    if (effectiveScope === "session" && Array.isArray(body.session_ids)) {
      if (!body.session_ids.every((s) => typeof s === "string")) {
        return NextResponse.json({ data: null, error: "Invalid session IDs" }, { status: 400 });
      }
      if ((body.session_ids as string[]).length > 0) {
        const newLinks = (body.session_ids as string[]).map((sid) => ({
          promo_code_id: id,
          session_id: sid,
        }));
        const { error: linkErr } = await supabase.from("promo_code_sessions").insert(newLinks);
        if (linkErr) {
          console.error("[admin/promo-codes/[id]] Session link insert failed:", linkErr);
          return NextResponse.json(
            { data: null, error: "Failed to update session links" },
            { status: 500 }
          );
        }
      }
    } else if (effectiveScope === "session_type" && Array.isArray(body.class_type_ids)) {
      if (!body.class_type_ids.every((ct) => typeof ct === "string")) {
        return NextResponse.json({ data: null, error: "Invalid class type IDs" }, { status: 400 });
      }
      if ((body.class_type_ids as string[]).length > 0) {
        const newLinks = (body.class_type_ids as string[]).map((ctid) => ({
          promo_code_id: id,
          class_type_id: ctid,
        }));
        const { error: linkErr } = await supabase.from("promo_code_class_types").insert(newLinks);
        if (linkErr) {
          console.error("[admin/promo-codes/[id]] Class type link insert failed:", linkErr);
          return NextResponse.json(
            { data: null, error: "Failed to update class type links" },
            { status: 500 }
          );
        }
      }
    }
    // effectiveScope === 'all': both tables already cleared, nothing to insert
  }

  return NextResponse.json({ data: { id }, error: null });
}

/**
 * Hard-deletes a promo code. Cascade removes all junction rows.
 * @param params - Route params containing the promo code ID
 * @returns JSON { data: { id: string }, error: null } or { data: null, error: string }
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireApiRole(["super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const supabase = await createAdminClient();

  const { error } = await supabase.from("promo_codes").delete().eq("id", id);

  if (error) {
    console.error("[admin/promo-codes/[id]] Delete failed:", error);
    return NextResponse.json(
      { data: null, error: "Failed to delete promo code" },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { id }, error: null });
}

/**
 * POST /api/team-bookings
 * Called by: CreateSessionClient (admin sessions/new form, team toggle on)
 * Auth: Instructor, Manager, or Super Admin
 *
 * Creates a team/corporate booking: optionally the private class session itself,
 * the team_bookings row, and — in company payment mode — the flat PayPal invoice
 * sent to the company contact.
 *
 * Two targets:
 *   - `session_id` supplied  → attach a team link to an existing class (rare).
 *   - session fields supplied → create a new private, hidden class (the norm).
 *
 * Instructors may only create bookings taught by themselves, mirroring
 * POST /api/sessions. Manager/super-admin sessions are auto-approved so the
 * share link works immediately; instructor-created ones wait for approval.
 *
 * Returns the share token so the caller can display the link to hand over.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createTeamBooking, type TeamPaymentMode } from "@/lib/team-bookings";
import { NextResponse } from "next/server";

/** Staff roles permitted to create team bookings. */
const ALLOWED_ROLES = ["instructor", "manager", "super_admin"] as const;

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a required non-empty trimmed string from the request body.
 * @param value - Raw body value.
 * @returns The trimmed string, or null when absent/blank/wrong type.
 */
function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Handles POST requests to create a team booking.
 * Validates the body, resolves the instructor, and delegates to createTeamBooking().
 * @param request - Incoming Next.js API request.
 * @returns JSON with the new ids and share token, or an error and status code.
 */
export async function POST(request: Request): Promise<Response> {
  // ── Auth (honors view-as: a downgraded super admin creates as instructor) ──
  const authResult = await requireApiRole([...ALLOWED_ROLES]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const isInstructor = actor.effectiveRole === "instructor";
  const adminClient = await createAdminClient();

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── Company / contact details ─────────────────────────────────────────────
  const companyName = requiredString(body.company_name);
  const contactName = requiredString(body.contact_name);
  const contactEmail = requiredString(body.contact_email);

  if (!companyName || !contactName || !contactEmail) {
    return NextResponse.json(
      { error: "Company name, contact name, and contact email are required." },
      { status: 400 }
    );
  }

  // Cheap shape check only — the real proof an address works is the invoice
  // email landing, and over-strict patterns reject valid corporate addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return NextResponse.json({ error: "Please enter a valid contact email." }, { status: 400 });
  }

  const paymentMode = body.payment_mode;
  if (paymentMode !== "company" && paymentMode !== "per_seat") {
    return NextResponse.json(
      { error: "payment_mode must be 'company' or 'per_seat'." },
      { status: 400 }
    );
  }

  const pricePerSeat = body.price_per_seat;
  const totalPrice = body.total_price;

  if (pricePerSeat !== undefined && pricePerSeat !== null && typeof pricePerSeat !== "number") {
    return NextResponse.json({ error: "price_per_seat must be a number." }, { status: 400 });
  }
  if (totalPrice !== undefined && totalPrice !== null && typeof totalPrice !== "number") {
    return NextResponse.json({ error: "total_price must be a number." }, { status: 400 });
  }

  const details = {
    companyName,
    contactName,
    contactEmail,
    contactPhone: typeof body.contact_phone === "string" ? body.contact_phone : null,
    paymentMode: paymentMode as TeamPaymentMode,
    pricePerSeat: (pricePerSeat as number | null | undefined) ?? null,
    totalPrice: (totalPrice as number | null | undefined) ?? null,
    classRequestId: typeof body.class_request_id === "string" ? body.class_request_id : null,
  };

  // ── Resolve the target: existing session, or a new one to create ──────────
  const existingSessionId = body.session_id;

  if (typeof existingSessionId === "string" && existingSessionId) {
    // Attaching to an existing class. An instructor may only do so for a class
    // they teach — otherwise they could bolt a corporate link onto anyone's session.
    if (isInstructor) {
      const { data: session } = await adminClient
        .from("class_sessions")
        .select("instructor_id")
        .eq("id", existingSessionId)
        .maybeSingle();

      if (!session || session.instructor_id !== actor.user.id) {
        return NextResponse.json(
          { error: "You can only create a team booking for a class you teach." },
          { status: 403 }
        );
      }
    }

    const result = await createTeamBooking(adminClient, {
      actorId: actor.user.id,
      actorRole: actor.effectiveRole as "instructor" | "manager" | "super_admin",
      details,
      target: { kind: "existing", sessionId: existingSessionId },
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result, { status: 201 });
  }

  // ── New-session path: validate the session fields ─────────────────────────
  const {
    class_type_id,
    instructor_id,
    location_id,
    starts_at,
    ends_at,
    max_capacity,
    notes,
    discount_percent,
  } = body;

  if (
    typeof class_type_id !== "string" || !class_type_id ||
    typeof location_id !== "string" || !location_id ||
    typeof starts_at !== "string" || !starts_at ||
    typeof ends_at !== "string" || !ends_at ||
    typeof max_capacity !== "number" || max_capacity < 1
  ) {
    return NextResponse.json(
      { error: "Missing or invalid required class fields." },
      { status: 400 }
    );
  }

  // Instructors are always their own instructor — reject attempts to impersonate.
  const resolvedInstructorId = isInstructor
    ? actor.user.id
    : typeof instructor_id === "string" && instructor_id
      ? instructor_id
      : null;

  if (!resolvedInstructorId) {
    return NextResponse.json(
      { error: "instructor_id is required for manager and super admin." },
      { status: 400 }
    );
  }

  const hasDiscount = discount_percent !== null && discount_percent !== undefined;
  if (
    hasDiscount &&
    (typeof discount_percent !== "number" || discount_percent < 0 || discount_percent > 50)
  ) {
    return NextResponse.json(
      { error: "discount_percent must be a number between 0 and 50." },
      { status: 400 }
    );
  }

  const start = new Date(starts_at);
  const end = new Date(ends_at);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: "ends_at must be after starts_at." }, { status: 400 });
  }

  const result = await createTeamBooking(adminClient, {
    actorId: actor.user.id,
    actorRole: actor.effectiveRole as "instructor" | "manager" | "super_admin",
    details,
    target: {
      kind: "new",
      session: {
        classTypeId: class_type_id,
        instructorId: resolvedInstructorId,
        locationId: location_id,
        startsAt: starts_at,
        endsAt: ends_at,
        maxCapacity: max_capacity,
        discountPercent: hasDiscount ? (discount_percent as number) : null,
        notes: typeof notes === "string" ? notes : null,
        // Add-ons are deliberately not offered on team bookings — the price is
        // a negotiated flat or per-seat rate agreed on the call.
        addonIds: [],
        skipInstructorCheck: isInstructor,
      },
    },
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result, { status: 201 });
}

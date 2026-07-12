/**
 * POST /api/invoices/create
 * Called by: CreateInvoiceClient (Step 3 "Send Invoice" button)
 * Auth: Instructor or Super Admin
 *
 * Validates the request body, re-verifies spot availability at submit time
 * (prevents race conditions), then delegates PayPal invoice creation, the DB
 * insert, activity logging, and the recipient email to createAndSendInvoice()
 * (lib/invoice-actions.ts) — the same helper used by the accept-teach
 * auto-invoicing flow, so both paths stay in sync.
 *
 * Instructor compensation is not paid directly from the invoice. When the
 * invoice is later marked paid, markInvoicePaidAndNotify() records instructor
 * earnings for the payout system.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { createAndSendInvoice } from "@/lib/invoice-actions";

/** Type guard — ensures a value is a non-null plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Minimal class type join shape used by this route. */
interface ClassTypeJoin {
  name?: string | null;
  price?: number | string | null;
}

/** Minimal location join shape used by this route. */
interface LocationJoin {
  name?: string | null;
  city?: string | null;
  state?: string | null;
}

/**
 * Parses a joined class_types value into the first class type object.
 * @param classTypes - Supabase FK join result.
 * @returns The single class type row or null.
 */
function firstClassType(classTypes: unknown): ClassTypeJoin | null {
  if (Array.isArray(classTypes)) return (classTypes[0] as ClassTypeJoin | undefined) ?? null;
  return (classTypes as ClassTypeJoin | null) ?? null;
}

/**
 * Parses a joined locations value into the first location object.
 * @param locations - Supabase FK join result.
 * @returns The single location row or null.
 */
function firstLocation(locations: unknown): LocationJoin | null {
  if (Array.isArray(locations)) return (locations[0] as LocationJoin | undefined) ?? null;
  return (locations as LocationJoin | null) ?? null;
}

/**
 * Validates and creates a SuperHeroCPR business PayPal invoice for a class session.
 * @param request - JSON request containing invoice details from CreateInvoiceClient.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    !isObject(body) ||
    typeof body.sessionId !== "string" ||
    typeof body.invoiceType !== "string" ||
    typeof body.recipientName !== "string" ||
    typeof body.recipientEmail !== "string" ||
    typeof body.studentCount !== "number" ||
    typeof body.customPrice !== "boolean" ||
    typeof body.totalAmount !== "number" ||
    typeof body.amountPerStudent !== "number"
  ) {
    return Response.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const {
    sessionId,
    invoiceType,
    recipientName,
    recipientEmail,
    studentCount,
    customPrice,
    totalAmount,
    amountPerStudent,
    notes,
  } = body;

  if (invoiceType !== "individual" && invoiceType !== "group") {
    return Response.json(
      { success: false, error: "Invalid invoice type" },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return Response.json(
      { success: false, error: "Invalid recipient email address" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(studentCount) || studentCount < 1) {
    return Response.json(
      { success: false, error: "Student count must be at least 1" },
      { status: 400 }
    );
  }

  if (totalAmount < 0 || amountPerStudent < 0) {
    return Response.json(
      { success: false, error: "Invoice amount cannot be negative" },
      { status: 400 }
    );
  }

  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();
  const { data: sessionData } = await adminClient
    .from("class_sessions")
    .select(`
      id, max_capacity, instructor_id, starts_at,
      class_types ( name, price ),
      locations ( name, city, state ),
      bookings ( id, cancelled ),
      invoices ( id, student_count, status )
    `)
    .eq("id", sessionId)
    .single();

  if (!sessionData) {
    return Response.json(
      { success: false, error: "Class session not found" },
      { status: 404 }
    );
  }

  if (actor.effectiveRole === "instructor" && sessionData.instructor_id !== actor.user.id) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const sessionBookings = Array.isArray(sessionData.bookings)
    ? sessionData.bookings
    : [];
  const sessionInvoices = Array.isArray(sessionData.invoices)
    ? sessionData.invoices
    : [];
  const activeBookings = sessionBookings.filter(
    (booking: { cancelled: boolean }) => !booking.cancelled
  ).length;
  const activeInvoiceStudents = sessionInvoices
    .filter((invoice: { status: string }) => invoice.status !== "cancelled")
    .reduce(
      (sum: number, invoice: { student_count: number }) =>
        sum + invoice.student_count,
      0
    );
  const spotsRemaining =
    sessionData.max_capacity - activeBookings - activeInvoiceStudents;

  if (studentCount > spotsRemaining) {
    return Response.json(
      {
        success: false,
        error: `Only ${spotsRemaining} spot${spotsRemaining === 1 ? "" : "s"} available. Please reduce the student count.`,
      },
      { status: 409 }
    );
  }

  const instructorId =
    actor.effectiveRole === "instructor" ? actor.user.id : sessionData.instructor_id;

  let instructorName: string | null = null;
  if (actor.effectiveRole === "instructor") {
    instructorName =
      [actor.profile.first_name, actor.profile.last_name].filter(Boolean).join(" ") || null;
  } else {
    const { data: instructorProfile } = await adminClient
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", instructorId)
      .single();
    instructorName = instructorProfile
      ? [instructorProfile.first_name, instructorProfile.last_name]
          .filter(Boolean)
          .join(" ") || null
      : null;
  }

  const classType = firstClassType(sessionData.class_types);
  const location = firstLocation(sessionData.locations);
  const className = classType?.name ?? "CPR Class";
  const locationName = location?.name ?? "";
  const locationCity = location?.city ?? "";
  const locationState = location?.state ?? "";
  const rawClassPrice = classType?.price;
  const classPrice =
    typeof rawClassPrice === "number"
      ? rawClassPrice
      : parseFloat(String(rawClassPrice ?? "0"));
  const serverTotalAmount = customPrice ? totalAmount : classPrice * studentCount;
  const serverAmountPerStudent = customPrice ? amountPerStudent : classPrice;

  if (!Number.isFinite(serverTotalAmount) || !Number.isFinite(serverAmountPerStudent)) {
    return Response.json(
      { success: false, error: "Session pricing unavailable" },
      { status: 500 }
    );
  }

  const companyName =
    invoiceType === "group" && typeof body.companyName === "string"
      ? body.companyName
      : null;
  const cleanNotes = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  const result = await createAndSendInvoice(adminClient, {
    sessionId,
    instructorId,
    instructorName,
    invoiceType,
    recipientName,
    recipientEmail,
    companyName,
    studentCount,
    amountPerStudent: serverAmountPerStudent,
    totalAmount: serverTotalAmount,
    customPrice,
    notes: cleanNotes,
    className,
    classDate: sessionData.starts_at as string,
    locationName,
    locationCity,
    locationState,
    actorId: actor.user.id,
  });

  if (!result.success) {
    return Response.json({ success: false, error: result.error }, { status: 502 });
  }

  return Response.json({
    success: true,
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
  });
}

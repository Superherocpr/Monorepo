/**
 * POST /api/invoices/create
 * Called by: CreateInvoiceClient (Step 3 "Send Invoice" button)
 * Auth: Instructor or Super Admin
 *
 * Creates a new SuperHeroCPR-collected invoice by:
 * 1. Validating the request body
 * 2. Re-verifying spot availability at submit time (prevents race conditions)
 * 3. Creating and sending a PayPal invoice from the business PayPal account
 * 4. Inserting the invoice record in the database
 * 5. Logging the creation in invoice_activity_log
 * 6. Sending the invoice email to the recipient via Resend
 *
 * Instructor compensation is not paid directly from the invoice. When the
 * invoice is later marked paid, /api/invoices/mark-paid records instructor
 * earnings for the payout system.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { Resend } from "resend";
import { invoiceEmail } from "@/lib/emails";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  getPayPalConnectBase,
} from "@/lib/paypal";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Type guard — ensures a value is a non-null plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Result from attempting to create an invoice on PayPal. */
interface PlatformResult {
  platformInvoiceId: string | null;
  paymentLink: string | null;
}

/** Parameters needed to create an invoice on PayPal. */
interface PlatformCreateParams {
  recipientEmail: string;
  className: string;
  studentCount: number;
  amountPerStudent: number;
  invoiceNumber: string;
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
 * Attempts to create and send a PayPal invoice from the business PayPal account.
 * Side effects: creates a PayPal invoice and sends it to the recipient.
 * @param params - Invoice details for the PayPal payload.
 * @returns PayPal invoice id and hosted payment link, or null fields on failure.
 */
async function createBusinessPayPalInvoice(
  params: PlatformCreateParams
): Promise<PlatformResult> {
  const accessToken = await getPayPalAccessToken();
  const apiBase = getPayPalApiBase();
  const connectBase = getPayPalConnectBase();

  try {
    const createRes = await fetch(`${apiBase}/v2/invoicing/invoices`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        detail: {
          invoice_date: new Date().toISOString().split("T")[0],
          currency_code: "USD",
          note: params.invoiceNumber,
        },
        primary_recipients: [
          { billing_info: { email_address: params.recipientEmail } },
        ],
        items: [
          {
            name: params.className,
            quantity: String(params.studentCount),
            unit_amount: {
              currency_code: "USD",
              value: params.amountPerStudent.toFixed(2),
            },
          },
        ],
      }),
      cache: "no-store",
    });

    if (!createRes.ok) {
      const errorText = await createRes.text().catch(() => "");
      console.error("[invoices/create] PayPal invoice create failed:", errorText);
      return { platformInvoiceId: null, paymentLink: null };
    }

    const createData = (await createRes.json()) as { id?: string };
    const platformInvoiceId = createData.id ?? null;
    if (!platformInvoiceId) return { platformInvoiceId: null, paymentLink: null };

    const sendRes = await fetch(
      `${apiBase}/v2/invoicing/invoices/${platformInvoiceId}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        cache: "no-store",
      }
    );

    if (!sendRes.ok) {
      const errorText = await sendRes.text().catch(() => "");
      console.error("[invoices/create] PayPal invoice send failed:", errorText);
      return { platformInvoiceId: null, paymentLink: null };
    }

    return {
      platformInvoiceId,
      paymentLink: `${connectBase}/invoice/p/#${platformInvoiceId}`,
    };
  } catch (err) {
    console.error("[invoices/create] PayPal invoice request failed:", err);
    return { platformInvoiceId: null, paymentLink: null };
  }
}

/**
 * Inserts the invoice row, retrying on invoice_number UNIQUE-constraint conflicts.
 * Side effects: INSERT into invoices.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param baseRow - The invoice row fields except invoice_number.
 * @returns The inserted invoice with id and invoice_number.
 * @throws Error if no number can be reserved within the retry limit.
 */
async function insertInvoiceWithUniqueNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient<any, "public", any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseRow: Record<string, any>
): Promise<{ id: string; invoice_number: string }> {
  const maxAttempts = 10;
  const { count } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });

  let nextInvoiceNumber = (count ?? 0) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = `INV-${String(nextInvoiceNumber).padStart(5, "0")}`;
    const { data, error } = await adminClient
      .from("invoices")
      .insert({ ...baseRow, invoice_number: candidate })
      .select("id, invoice_number")
      .single();

    if (!error && data) {
      return {
        id: data.id as string,
        invoice_number: data.invoice_number as string,
      };
    }

    if (error?.code === "23505") {
      nextInvoiceNumber += 1;
      continue;
    }

    throw new Error(
      `Invoice insert failed: ${error?.message ?? "unknown error"}`
    );
  }

  throw new Error(
    `Failed to reserve a unique invoice number after ${maxAttempts} attempts.`
  );
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
 * Creates and sends a SuperHeroCPR business PayPal invoice for a class session.
 * Side effects: PayPal invoice creation, DB insert, activity log inserts, and email send.
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

  const { count: invoiceCount } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });
  const invoiceNumber = `INV-${String((invoiceCount ?? 0) + 1).padStart(5, "0")}`;

  const { platformInvoiceId, paymentLink } = await createBusinessPayPalInvoice({
    recipientEmail,
    className,
    studentCount,
    amountPerStudent: serverAmountPerStudent,
    invoiceNumber,
  });

  if (!platformInvoiceId || !paymentLink) {
    return Response.json(
      {
        success: false,
        error:
          "We couldn't create the invoice in PayPal. Please check the business PayPal settings and try again.",
      },
      { status: 502 }
    );
  }

  const companyName =
    invoiceType === "group" && typeof body.companyName === "string"
      ? body.companyName
      : null;
  const cleanNotes = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  let invoice: { id: string; invoice_number: string };
  try {
    invoice = await insertInvoiceWithUniqueNumber(adminClient, {
      class_session_id: sessionId,
      instructor_id: instructorId,
      invoice_type: invoiceType,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      company_name: companyName,
      student_count: studentCount,
      amount_per_student: serverAmountPerStudent,
      custom_price: customPrice,
      total_amount: serverTotalAmount,
      payment_platform: "paypal",
      platform_invoice_id: platformInvoiceId,
      notes: cleanNotes,
      status: "sent",
    });
  } catch (err) {
    console.error("[invoices/create] Invoice insert failed:", err);
    return Response.json(
      { success: false, error: "Failed to create invoice. Please try again." },
      { status: 500 }
    );
  }

  await adminClient.from("invoice_activity_log").insert([
    {
      invoice_id: invoice.id,
      actor_id: actor.user.id,
      action: "created",
      notes: "Business PayPal invoice created",
    },
    {
      invoice_id: invoice.id,
      actor_id: actor.user.id,
      action: "sent",
      notes: null,
    },
  ]);

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = invoiceEmail({
      invoiceNumber: invoice.invoice_number,
      recipientName,
      invoiceType: invoiceType as "individual" | "group",
      companyName,
      studentCount,
      totalAmount: serverTotalAmount,
      className,
      classDate: sessionData.starts_at as string,
      locationName,
      locationCity,
      locationState,
      instructorName,
      notes: cleanNotes,
      paymentLink,
    });
    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: recipientEmail,
        subject,
        html,
        ...(invoiceType === "group" && {
          attachments: [
            {
              filename: "roster-template.csv",
              content: Buffer.from(
                [
                  `"First Name","Last Name","Email","Phone","Employer"`,
                  `"Jane","Smith","jane.smith@example.com","555-867-5309","Acme Hospital"`,
                  `"John","Doe","john.doe@example.com","",""`,
                ].join("\r\n")
              ),
            },
          ],
        }),
      })
      .catch((err: unknown) => {
        console.error(
          "[invoices/create] Resend email failed (non-fatal):",
          err
        );
      });
  }

  return Response.json({
    success: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
  });
}

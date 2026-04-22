/**
 * POST /api/invoices/create
 * Called by: CreateInvoiceClient (Step 3 "Send Invoice" button)
 * Auth: Instructor or Super Admin
 *
 * Creates a new invoice by:
 * 1. Validating the request body
 * 2. Re-verifying spot availability at submit time (prevents race conditions)
 * 3. Generating the next sequential invoice number
 * 4. Attempting to create the invoice on the instructor's payment platform
 * 5. Inserting the invoice record in the database
 * 6. Logging the creation in invoice_activity_log
 * 7. Sending the invoice email to the recipient via Resend
 *
 * Platform invoice creation (Step 4) is best-effort — if the platform call fails
 * (e.g. expired OAuth token), platform_invoice_id is stored as null. The invoice
 * DB record is still created so the transaction is not lost.
 *
 * For group invoices, the email includes a roster upload link so the company
 * can pre-register their attendees before class day.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import type { PaymentPlatform } from "@/types/users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Type guard — ensures a value is a non-null plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Result from attempting to create an invoice on a payment platform. */
interface PlatformResult {
  platformInvoiceId: string | null;
  paymentLink: string | null;
}

/** Parameters needed to create an invoice on a payment platform. */
interface PlatformCreateParams {
  recipientEmail: string;
  className: string;
  studentCount: number;
  amountPerStudent: number;
  totalAmount: number;
  invoiceNumber: string;
}

// ---------------------------------------------------------------------------
// Platform invoice creation
// ---------------------------------------------------------------------------

/**
 * Attempts to create an invoice on PayPal's invoicing API and send it.
 * PayPal and Venmo Business use the same endpoint.
 * Returns null identifiers on any failure — caller always records the DB row.
 * @param accessToken - The instructor's PayPal OAuth access token.
 * @param params - Invoice details for the payload.
 */
async function createPayPalInvoice(
  accessToken: string,
  params: PlatformCreateParams
): Promise<PlatformResult> {
  try {
    const createRes = await fetch(
      "https://api-m.paypal.com/v2/invoicing/invoices",
      {
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
            {
              billing_info: {
                email_address: params.recipientEmail,
              },
            },
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
      }
    );

    if (!createRes.ok) return { platformInvoiceId: null, paymentLink: null };

    const createData = (await createRes.json()) as { id?: string };
    const platformInvoiceId = createData.id ?? null;
    if (!platformInvoiceId) return { platformInvoiceId: null, paymentLink: null };

    // Send the invoice so the recipient receives the email on PayPal's side
    const sendRes = await fetch(
      `https://api-m.paypal.com/v2/invoicing/invoices/${platformInvoiceId}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!sendRes.ok) return { platformInvoiceId: null, paymentLink: null };

    return {
      platformInvoiceId,
      paymentLink: `https://www.paypal.com/invoice/p/#${platformInvoiceId}`,
    };
  } catch {
    return { platformInvoiceId: null, paymentLink: null };
  }
}

/**
 * Attempts to create and publish an invoice on Stripe.
 * Uses Stripe's form-encoded API with the access token as the secret key.
 * Returns null identifiers on any failure.
 * @param accessToken - The instructor's Stripe secret key (OAuth access token).
 * @param params - Invoice details.
 */
async function createStripeInvoice(
  accessToken: string,
  params: PlatformCreateParams
): Promise<PlatformResult> {
  try {
    const stripeHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Find or create a Stripe customer for this email address
    const searchRes = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(params.recipientEmail)}&limit=1`,
      { headers: stripeHeaders }
    );
    if (!searchRes.ok) return { platformInvoiceId: null, paymentLink: null };

    const searchData = (await searchRes.json()) as {
      data: Array<{ id: string }>;
    };

    let customerId: string;

    if (searchData.data.length > 0) {
      customerId = searchData.data[0].id;
    } else {
      const custRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: stripeHeaders,
        body: new URLSearchParams({ email: params.recipientEmail }),
      });
      if (!custRes.ok) return { platformInvoiceId: null, paymentLink: null };
      const custData = (await custRes.json()) as { id: string };
      customerId = custData.id;
    }

    // Create an invoice item for the class
    const itemParams = new URLSearchParams({
      customer: customerId,
      "price_data[currency]": "usd",
      "price_data[product_data][name]": params.className,
      "price_data[unit_amount]": String(
        Math.round(params.amountPerStudent * 100)
      ),
      quantity: String(params.studentCount),
    });

    const itemRes = await fetch("https://api.stripe.com/v1/invoiceitems", {
      method: "POST",
      headers: stripeHeaders,
      body: itemParams,
    });
    if (!itemRes.ok) return { platformInvoiceId: null, paymentLink: null };

    // Create the invoice
    const invParams = new URLSearchParams({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: "14",
    });

    const invRes = await fetch("https://api.stripe.com/v1/invoices", {
      method: "POST",
      headers: stripeHeaders,
      body: invParams,
    });
    if (!invRes.ok) return { platformInvoiceId: null, paymentLink: null };

    const invData = (await invRes.json()) as {
      id: string;
      hosted_invoice_url?: string;
    };
    const platformInvoiceId = invData.id;

    // Finalize and send the invoice
    const finalizeRes = await fetch(
      `https://api.stripe.com/v1/invoices/${platformInvoiceId}/finalize`,
      { method: "POST", headers: stripeHeaders }
    );
    if (!finalizeRes.ok) return { platformInvoiceId: null, paymentLink: null };

    const sendRes = await fetch(
      `https://api.stripe.com/v1/invoices/${platformInvoiceId}/send`,
      { method: "POST", headers: stripeHeaders }
    );
    if (!sendRes.ok) return { platformInvoiceId: null, paymentLink: null };

    return {
      platformInvoiceId,
      paymentLink: invData.hosted_invoice_url ?? null,
    };
  } catch {
    return { platformInvoiceId: null, paymentLink: null };
  }
}

/**
 * Attempts to create and publish an invoice on Square.
 * Square invoicing requires a location_id — we use the platform_account_id
 * field as the Square location ID (set at OAuth connection time).
 * Returns null identifiers on any failure.
 * @param accessToken - The instructor's Square OAuth access token.
 * @param locationId - The instructor's Square location ID.
 * @param params - Invoice details.
 */
async function createSquareInvoice(
  accessToken: string,
  locationId: string,
  params: PlatformCreateParams
): Promise<PlatformResult> {
  try {
    const squareHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": "2024-01-18",
    };

    // Create a quick-pay invoice (no order required for simple one-off charges)
    const idempotencyKey = `${params.invoiceNumber}-${Date.now()}`;
    const createRes = await fetch(
      "https://connect.squareup.com/v2/invoices",
      {
        method: "POST",
        headers: squareHeaders,
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          invoice: {
            location_id: locationId,
            delivery_method: "EMAIL",
            invoice_number: params.invoiceNumber,
            title: params.className,
            primary_recipient: {
              email_address: params.recipientEmail,
            },
            payment_requests: [
              {
                request_type: "BALANCE",
                due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
                  .toISOString()
                  .split("T")[0],
                tipping_enabled: false,
                automatic_payment_source: "NONE",
                reminders: [],
                computed_amount_money: {
                  amount: Math.round(params.totalAmount * 100),
                  currency: "USD",
                },
              },
            ],
            accepted_payment_methods: {
              card: true,
              square_gift_card: false,
              bank_account: false,
              buy_now_pay_later: false,
              cash_app_pay: false,
            },
          },
        }),
      }
    );

    if (!createRes.ok) return { platformInvoiceId: null, paymentLink: null };

    const createData = (await createRes.json()) as {
      invoice?: { id: string; public_url?: string };
    };
    const squareInvoice = createData.invoice;
    if (!squareInvoice?.id) return { platformInvoiceId: null, paymentLink: null };

    // Publish the invoice so Square sends it to the recipient
    const publishRes = await fetch(
      `https://connect.squareup.com/v2/invoices/${squareInvoice.id}/publish`,
      {
        method: "POST",
        headers: squareHeaders,
        body: JSON.stringify({
          idempotency_key: `${idempotencyKey}-publish`,
          version: 1,
        }),
      }
    );

    if (!publishRes.ok) return { platformInvoiceId: null, paymentLink: null };

    return {
      platformInvoiceId: squareInvoice.id,
      paymentLink: squareInvoice.public_url ?? null,
    };
  } catch {
    return { platformInvoiceId: null, paymentLink: null };
  }
}

/**
 * Dispatches to the correct platform invoice creation function.
 * Always returns gracefully — callers should not depend on a non-null result.
 * @param platform - Which payment platform to use.
 * @param accessToken - The instructor's OAuth access token for that platform.
 * @param platformAccountId - The instructor's account/location ID on the platform.
 * @param params - Invoice details needed by all platforms.
 */
async function createOnPlatform(
  platform: PaymentPlatform,
  accessToken: string | null,
  platformAccountId: string | null,
  params: PlatformCreateParams
): Promise<PlatformResult> {
  if (!accessToken) return { platformInvoiceId: null, paymentLink: null };

  if (platform === "paypal" || platform === "venmo_business") {
    return createPayPalInvoice(accessToken, params);
  }

  if (platform === "stripe") {
    return createStripeInvoice(accessToken, params);
  }

  if (platform === "square") {
    // Square requires a location ID stored in platform_account_id
    if (!platformAccountId) {
      return { platformInvoiceId: null, paymentLink: null };
    }
    return createSquareInvoice(accessToken, platformAccountId, params);
  }

  return { platformInvoiceId: null, paymentLink: null };
}

// ---------------------------------------------------------------------------
// Email sender
// ---------------------------------------------------------------------------

/**
 * Sends the invoice email via Resend.
 * Silently skips if RESEND_API_KEY is not configured (dev environments).
 * Group invoices include a link to the /submit-roster page so the company can
 * pre-register their attendees before class day.
 */
async function sendInvoiceEmail(params: {
  invoiceNumber: string;
  recipientName: string;
  recipientEmail: string;
  invoiceType: "individual" | "group";
  companyName: string | null;
  studentCount: number;
  totalAmount: number;
  className: string;
  classDate: string;
  locationName: string;
  locationCity: string;
  locationState: string;
  notes: string | null;
  paymentLink: string | null;
  sessionId: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const resend = new Resend(process.env.RESEND_API_KEY);

  const formattedDate = new Date(params.classDate).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(params.totalAmount);

  const paymentRow = params.paymentLink
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Pay here:</td>
        <td style="padding:6px 0;font-size:14px;"><a href="${params.paymentLink}" style="color:#dc2626;">${params.paymentLink}</a></td>
       </tr>`
    : "";

  const rosterSection =
    params.invoiceType === "group"
      ? `<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
         <p style="font-size:14px;color:#374151;font-weight:600;">Submitting your student roster</p>
         <p style="font-size:14px;color:#6b7280;">
           If you have a list of staff attending this class, you can submit it in advance to save time on class day.
           This is only needed if you have multiple attendees and want to pre-register them.
         </p>
         <p style="font-size:14px;color:#6b7280;">Your invoice number: <strong>${params.invoiceNumber}</strong></p>
         <p>
           <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://superherocpr.com"}/submit-roster?invoice=${params.invoiceNumber}"
              style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
             Submit Your Roster →
           </a>
         </p>
         <p style="font-size:12px;color:#9ca3af;">Note: Individual students do not need to submit a roster.</p>`
      : "";

  const companyRow = params.companyName
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;">Company:</td>
        <td style="padding:6px 0;font-size:14px;">${params.companyName}</td>
       </tr>`
    : "";

  const notesRow = params.notes
    ? `<tr>
        <td style="padding:6px 0;color:#6b7280;font-size:14px;vertical-align:top;">Note:</td>
        <td style="padding:6px 0;font-size:14px;">${params.notes}</td>
       </tr>`
    : "";

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h1 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:4px;">Invoice from Superhero CPR</h1>
      <p style="font-size:14px;color:#6b7280;margin-bottom:24px;">Invoice number: <strong>${params.invoiceNumber}</strong></p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">To:</td>
          <td style="padding:6px 0;font-size:14px;font-weight:600;">${params.recipientName}</td>
        </tr>
        ${companyRow}
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Class:</td>
          <td style="padding:6px 0;font-size:14px;">${params.className}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Date:</td>
          <td style="padding:6px 0;font-size:14px;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Location:</td>
          <td style="padding:6px 0;font-size:14px;">${params.locationName}, ${params.locationCity}, ${params.locationState}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Students:</td>
          <td style="padding:6px 0;font-size:14px;">${params.studentCount}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:14px;">Amount:</td>
          <td style="padding:6px 0;font-size:16px;font-weight:700;color:#111827;">${formattedAmount}</td>
        </tr>
        ${notesRow}
        ${paymentRow}
      </table>

      ${rosterSection}

      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="font-size:12px;color:#9ca3af;">
        This invoice was sent by a Superhero CPR instructor. For questions, reply to this email.
      </p>
    </div>
  `;

  await resend.emails.send({
    from: "Superhero CPR <noreply@superherocpr.com>",
    to: params.recipientEmail,
    subject: `Invoice ${params.invoiceNumber} — ${params.className} on ${formattedDate}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Parse and validate the request body
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

  // Validate invoice type enum
  if (invoiceType !== "individual" && invoiceType !== "group") {
    return Response.json(
      { success: false, error: "Invalid invoice type" },
      { status: 400 }
    );
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail as string)) {
    return Response.json(
      { success: false, error: "Invalid recipient email address" },
      { status: 400 }
    );
  }

  // Validate student count is a positive integer
  if (!Number.isInteger(studentCount) || (studentCount as number) < 1) {
    return Response.json(
      { success: false, error: "Student count must be at least 1" },
      { status: 400 }
    );
  }

  // Validate total amount is non-negative
  if ((totalAmount as number) < 0) {
    return Response.json(
      { success: false, error: "Total amount cannot be negative" },
      { status: 400 }
    );
  }

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, email")
    .eq("id", user.id)
    .single();

  if (!profile || !["instructor", "super_admin"].includes(profile.role as string)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const adminClient = await createAdminClient();

  // Step 1: Re-verify spot availability at submit time to prevent race conditions
  const { data: sessionData } = await adminClient
    .from("class_sessions")
    .select(`
      id, max_capacity, instructor_id,
      class_types ( name ),
      locations ( name, city, state ),
      bookings ( id, cancelled ),
      invoices ( id, student_count, status )
    `)
    .eq("id", sessionId as string)
    .single();

  if (!sessionData) {
    return Response.json(
      { success: false, error: "Class session not found" },
      { status: 404 }
    );
  }

  // Instructors may only create invoices for their own sessions
  if (
    profile.role === "instructor" &&
    sessionData.instructor_id !== profile.id
  ) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const sessionBookings = Array.isArray(sessionData.bookings)
    ? sessionData.bookings
    : [];
  const sessionInvoices = Array.isArray(sessionData.invoices)
    ? sessionData.invoices
    : [];

  const activeBookings = sessionBookings.filter(
    (b: { cancelled: boolean }) => !b.cancelled
  ).length;

  const activeInvoiceStudents = sessionInvoices
    .filter((inv: { status: string }) => inv.status !== "cancelled")
    .reduce(
      (sum: number, inv: { student_count: number }) => sum + inv.student_count,
      0
    );

  const spotsRemaining =
    sessionData.max_capacity - activeBookings - activeInvoiceStudents;

  if ((studentCount as number) > spotsRemaining) {
    return Response.json(
      {
        success: false,
        error: `Only ${spotsRemaining} spot${spotsRemaining === 1 ? "" : "s"} available. Please reduce the student count.`,
      },
      { status: 409 }
    );
  }

  // Step 2: Generate the next sequential invoice number
  const { count } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });

  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(5, "0")}`;

  // Step 3: Get the instructor's active payment account
  const instructorId =
    profile.role === "instructor" ? profile.id : sessionData.instructor_id;

  const { data: paymentAccount } = await adminClient
    .from("instructor_payment_accounts")
    .select("platform, access_token, platform_account_id")
    .eq("instructor_id", instructorId)
    .eq("is_active", true)
    .single();

  if (!paymentAccount) {
    return Response.json(
      {
        success: false,
        error:
          "No active payment account found. Please connect a payment account first.",
      },
      { status: 400 }
    );
  }

  // Extract class/location details for the platform call and email
  const classType = Array.isArray(sessionData.class_types)
    ? sessionData.class_types[0]
    : sessionData.class_types;
  const location = Array.isArray(sessionData.locations)
    ? sessionData.locations[0]
    : sessionData.locations;

  const className = (classType as { name?: string } | null)?.name ?? "CPR Class";
  const locationName = (location as { name?: string } | null)?.name ?? "";
  const locationCity = (location as { city?: string } | null)?.city ?? "";
  const locationState = (location as { state?: string } | null)?.state ?? "";

  // Step 4: Attempt to create the invoice on the payment platform.
  // Best-effort — a failure here does not block DB record creation.
  const { platformInvoiceId, paymentLink } = await createOnPlatform(
    paymentAccount.platform as PaymentPlatform,
    paymentAccount.access_token as string | null,
    paymentAccount.platform_account_id as string | null,
    {
      recipientEmail: recipientEmail as string,
      className,
      studentCount: studentCount as number,
      amountPerStudent: amountPerStudent as number,
      totalAmount: totalAmount as number,
      invoiceNumber,
    }
  );

  // Step 5: Insert the invoice record
  const companyName =
    invoiceType === "group" && typeof body.companyName === "string"
      ? body.companyName
      : null;

  const { data: invoice, error: insertError } = await adminClient
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      class_session_id: sessionId,
      instructor_id: instructorId,
      invoice_type: invoiceType,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      company_name: companyName,
      student_count: studentCount,
      amount_per_student: amountPerStudent,
      custom_price: customPrice,
      total_amount: totalAmount,
      payment_platform: paymentAccount.platform,
      platform_invoice_id: platformInvoiceId,
      notes: notes ?? null,
      status: "sent",
    })
    .select("id, invoice_number")
    .single();

  if (insertError || !invoice) {
    return Response.json(
      { success: false, error: "Failed to create invoice. Please try again." },
      { status: 500 }
    );
  }

  // Step 6: Log the creation and send actions in the activity log
  await adminClient.from("invoice_activity_log").insert([
    {
      invoice_id: invoice.id,
      actor_id: profile.id,
      action: "created",
      notes: null,
    },
    {
      invoice_id: invoice.id,
      actor_id: profile.id,
      action: "sent",
      notes: null,
    },
  ]);

  // Step 7: Send the invoice email to the recipient
  await sendInvoiceEmail({
    invoiceNumber: invoice.invoice_number,
    recipientName: recipientName as string,
    recipientEmail: recipientEmail as string,
    invoiceType: invoiceType as "individual" | "group",
    companyName: companyName as string | null,
    studentCount: studentCount as number,
    totalAmount: totalAmount as number,
    className,
    classDate: sessionData.starts_at as string,
    locationName,
    locationCity,
    locationState,
    notes: notes as string | null,
    paymentLink,
    sessionId: sessionId as string,
  });

  return Response.json({
    success: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
  });
}

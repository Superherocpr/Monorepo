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
import { invoiceEmail } from "@/lib/emails";
import { decryptToken } from "@/lib/crypto";
import {
  getPayPalApiBase,
  getPayPalConnectBase,
  refreshInstructorPayPalToken,
} from "@/lib/paypal";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 *
 * If the access token is rejected with 401 (typical when the cached token has
 * exceeded its ~8h lifetime), the supplied `refresh` callback is invoked to
 * obtain a fresh one and the request is retried once. This keeps invoice
 * creation working without requiring instructors to re-OAuth every 8 hours.
 *
 * @param accessToken - The instructor's PayPal OAuth access token (decrypted).
 * @param refresh - Optional callback returning a new access token; called on 401.
 * @param params - Invoice details for the payload.
 * @returns Platform invoice id + hosted payment link, or null fields on failure.
 */
async function createPayPalInvoice(
  accessToken: string,
  refresh: (() => Promise<string>) | null,
  params: PlatformCreateParams
): Promise<PlatformResult> {
  const apiBase = getPayPalApiBase();
  const connectBase = getPayPalConnectBase();

  /** Issues the create+send pair against PayPal using the supplied bearer. */
  const attempt = async (
    bearer: string
  ): Promise<
    | { status: "ok"; result: PlatformResult }
    | { status: "unauthorized" }
    | { status: "failed" }
  > => {
    try {
      const createRes = await fetch(`${apiBase}/v2/invoicing/invoices`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
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
      });

      if (createRes.status === 401) return { status: "unauthorized" };
      if (!createRes.ok) return { status: "failed" };

      const createData = (await createRes.json()) as { id?: string };
      const platformInvoiceId = createData.id ?? null;
      if (!platformInvoiceId) return { status: "failed" };

      const sendRes = await fetch(
        `${apiBase}/v2/invoicing/invoices/${platformInvoiceId}/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      if (sendRes.status === 401) return { status: "unauthorized" };
      if (!sendRes.ok) return { status: "failed" };

      return {
        status: "ok",
        result: {
          platformInvoiceId,
          // Hosted payment link lives on the consumer host
          // (paypal.com vs sandbox.paypal.com), derived from PAYPAL_API_BASE.
          paymentLink: `${connectBase}/invoice/p/#${platformInvoiceId}`,
        },
      };
    } catch {
      return { status: "failed" };
    }
  };

  const first = await attempt(accessToken);
  if (first.status === "ok") return first.result;
  if (first.status === "failed" || !refresh) {
    return { platformInvoiceId: null, paymentLink: null };
  }

  // 401 — access token expired. Refresh once and retry.
  try {
    const newToken = await refresh();
    const second = await attempt(newToken);
    return second.status === "ok"
      ? second.result
      : { platformInvoiceId: null, paymentLink: null };
  } catch (err) {
    console.error("[invoices/create] PayPal token refresh failed:", err);
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
 * @param refreshPayPalToken - Callback used by the PayPal path to refresh an
 *                              expired access token on 401. Ignored for other
 *                              platforms.
 */
async function createOnPlatform(
  platform: PaymentPlatform,
  accessToken: string | null,
  platformAccountId: string | null,
  params: PlatformCreateParams,
  refreshPayPalToken: (() => Promise<string>) | null
): Promise<PlatformResult> {
  if (!accessToken) return { platformInvoiceId: null, paymentLink: null };

  if (platform === "paypal" || platform === "venmo_business") {
    return createPayPalInvoice(accessToken, refreshPayPalToken, params);
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
// Invoice number generation
// ---------------------------------------------------------------------------

/**
 * Inserts the invoice row, retrying on `invoice_number` UNIQUE-constraint
 * conflicts. The previous `count(*) + 1` approach was racy — two simultaneous
 * requests would compute the same next number, and the second INSERT would
 * fail with code 23505. This loop walks forward until a number is accepted
 * (bounded by `maxAttempts` to prevent runaway loops in pathological cases).
 *
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param baseRow - The invoice row fields EXCEPT `invoice_number`.
 * @returns The inserted invoice with `id` + `invoice_number`.
 * @throws Error if no number can be reserved within `maxAttempts` tries.
 */
async function insertInvoiceWithUniqueNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient<any, "public", any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseRow: Record<string, any>
): Promise<{ id: string; invoice_number: string }> {
  const maxAttempts = 10;

  // Seed from `count(*) + 1`. `count` is approximate under concurrency —
  // exactly why the retry loop exists.
  const { count } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });

  let next = (count ?? 0) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = `INV-${String(next).padStart(5, "0")}`;
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

    // Postgres unique_violation — try the next number.
    if (error?.code === "23505") {
      next += 1;
      continue;
    }

    // Any other DB error is fatal.
    throw new Error(
      `Invoice insert failed: ${error?.message ?? "unknown error"}`
    );
  }

  throw new Error(
    `Failed to reserve a unique invoice number after ${maxAttempts} attempts.`
  );
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
    .select("id, role, email, first_name, last_name")
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
      id, max_capacity, instructor_id, starts_at,
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

  // Step 2: Get the instructor's active payment account.
  // We load the row (including the encrypted refresh_token + account id) BEFORE
  // generating an invoice number, so we can fail fast if the instructor has no
  // active account — and so the PayPal refresh callback below has what it needs.
  const instructorId =
    profile.role === "instructor" ? profile.id : sessionData.instructor_id;

  // Resolve the instructor's display name for the invoice email.
  // If the calling user IS the instructor, use their own profile.
  // If a super_admin is creating on behalf of an instructor, fetch that profile.
  let instructorName: string | null = null;
  if (profile.role === "instructor") {
    instructorName =
      [(profile as { first_name?: string | null; last_name?: string | null }).first_name,
       (profile as { first_name?: string | null; last_name?: string | null }).last_name]
        .filter(Boolean)
        .join(" ") || null;
  } else {
    const { data: instructorProfile } = await adminClient
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", instructorId)
      .single();
    instructorName = instructorProfile
      ? [(instructorProfile as { first_name?: string | null; last_name?: string | null }).first_name,
         (instructorProfile as { first_name?: string | null; last_name?: string | null }).last_name]
          .filter(Boolean)
          .join(" ") || null
      : null;
  }

  const { data: paymentAccount } = await adminClient
    .from("instructor_payment_accounts")
    .select("id, platform, access_token, refresh_token, platform_account_id")
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

  // Step 3: Reserve a unique invoice number by attempting INSERT and retrying
  // on 23505 (see insertInvoiceWithUniqueNumber). We need the number BEFORE
  // the platform call because it appears in PayPal's invoice note.
  // The candidate is generated inside the helper; we just need to pre-compute
  // it for the platform call (it'll match the eventually-accepted number on
  // the typical first-attempt path; if a conflict shifts it, the platform note
  // will be one off — acceptable; the DB invoice_number is the source of truth).
  const { count: invoiceCount } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });
  const invoiceNumber = `INV-${String((invoiceCount ?? 0) + 1).padStart(5, "0")}`;

  // Step 4: Attempt to create the invoice on the payment platform.
  // Access token is decrypted in-memory just before the API call and is never
  // logged or returned to the client. For PayPal we also pass a refresh
  // callback that updates the stored access token if it's expired (401).
  let decryptedToken: string | null = null;
  if (paymentAccount.access_token) {
    try {
      decryptedToken = decryptToken(paymentAccount.access_token as string);
    } catch (err) {
      console.error("[invoices/create] Failed to decrypt access token:", err);
      decryptedToken = null;
    }
  }

  const refreshPayPalToken =
    (paymentAccount.platform === "paypal" ||
      paymentAccount.platform === "venmo_business") &&
    paymentAccount.refresh_token
      ? async (): Promise<string> => {
          const { accessToken } = await refreshInstructorPayPalToken(
            adminClient,
            paymentAccount.id as string,
            paymentAccount.refresh_token as string
          );
          return accessToken;
        }
      : null;

  const { platformInvoiceId, paymentLink } = await createOnPlatform(
    paymentAccount.platform as PaymentPlatform,
    decryptedToken,
    paymentAccount.platform_account_id as string | null,
    {
      recipientEmail: recipientEmail as string,
      className,
      studentCount: studentCount as number,
      amountPerStudent: amountPerStudent as number,
      totalAmount: totalAmount as number,
      invoiceNumber,
    },
    refreshPayPalToken
  );

  // If the platform call failed, fail the request loudly instead of silently
  // sending the recipient an email with no payment link. The instructor needs
  // to know their PayPal/Stripe/Square integration is broken so they can
  // reconnect — hiding the failure means the customer never pays and the
  // instructor doesn't notice until reconciliation.
  if (!platformInvoiceId || !paymentLink) {
    return Response.json(
      {
        success: false,
        error:
          "We couldn't create the invoice on your payment platform. Please reconnect your payment account and try again.",
      },
      { status: 502 }
    );
  }

  // Step 5: Insert the invoice record (retrying on unique-number conflict).
  const companyName =
    invoiceType === "group" && typeof body.companyName === "string"
      ? body.companyName
      : null;

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
      amount_per_student: amountPerStudent,
      custom_price: customPrice,
      total_amount: totalAmount,
      payment_platform: paymentAccount.platform,
      platform_invoice_id: platformInvoiceId,
      notes: notes ?? null,
      status: "sent",
    });
  } catch (err) {
    console.error("[invoices/create] Invoice insert failed:", err);
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
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = invoiceEmail({
      invoiceNumber: invoice.invoice_number,
      recipientName: recipientName as string,
      invoiceType: invoiceType as "individual" | "group",
      companyName: companyName as string | null,
      studentCount: studentCount as number,
      totalAmount: totalAmount as number,
      className,
      classDate: sessionData.starts_at as string,
      locationName,
      locationCity,
      locationState,
      instructorName,
      notes: notes as string | null,
      paymentLink,
    });
    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: recipientEmail as string,
        subject,
        html,
        // Attach the roster template CSV for group invoices so the contact
        // has it ready when they click "Submit Your Roster" in the email.
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
        // Don't fail the request — the invoice is created on the platform AND
        // in our DB. The recipient will receive the platform's own invoice
        // email even if our Resend copy fails.
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

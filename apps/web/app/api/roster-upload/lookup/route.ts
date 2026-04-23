/**
 * POST /api/roster-upload/lookup
 * Called by: SubmitRosterClient Step 1 ("Find My Class" button and auto-advance on ?invoice= param)
 * Auth: None — fully public
 * Validates an invoice number and returns the associated class session details
 * so the customer can confirm they have the right class before uploading their roster.
 */

import { createAdminClient } from "@/lib/supabase/server";

interface LookupBody {
  invoiceNumber: string;
}

/**
 * Looks up a group invoice by its invoice number and returns session details
 * for customer confirmation on the submit-roster page.
 * Returns specific, actionable error messages for individual and cancelled invoices.
 * @param request - JSON body containing { invoiceNumber }
 */
export async function POST(request: Request) {
  let body: LookupBody;
  try {
    body = (await request.json()) as LookupBody;
  } catch {
    return Response.json({ valid: false, error: "Invalid request." }, { status: 400 });
  }

  const invoiceNumber = (body.invoiceNumber ?? "").trim().toUpperCase();
  if (!invoiceNumber) {
    return Response.json(
      { valid: false, error: "Invoice number is required." },
      { status: 400 }
    );
  }

  // Admin client used here since this is a public route with no user session —
  // RLS policies may not allow anonymous reads of invoice records.
  const supabase = await createAdminClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select(`
      id, invoice_type, status, invoice_number,
      class_sessions (
        id, starts_at,
        class_types ( name ),
        locations ( name, city, state ),
        profiles!instructor_id ( first_name, last_name )
      )
    `)
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();

  // Invoice not found — give a helpful message that references the invoice email
  if (!invoice) {
    return Response.json({
      valid: false,
      session: null,
      invoiceId: null,
      sessionId: null,
      error:
        "We couldn't find an invoice with that number. Please check the invoice email and try again.",
    });
  }

  // Individual invoices don't use the roster upload flow
  if (invoice.invoice_type === "individual") {
    return Response.json({
      valid: false,
      session: null,
      invoiceId: null,
      sessionId: null,
      error:
        "This invoice doesn't require a roster. Individual bookings are managed separately.",
    });
  }

  if (invoice.status === "cancelled") {
    return Response.json({
      valid: false,
      session: null,
      invoiceId: null,
      sessionId: null,
      error:
        "This invoice has been cancelled. Please contact your instructor if you have questions.",
    });
  }

  // Cast the joined session — Supabase returns a many-to-one join as a single object
  const session = invoice.class_sessions as unknown as {
    id: string;
    starts_at: string;
    class_types: { name: string } | null;
    locations: { name: string; city: string; state: string } | null;
    profiles: { first_name: string; last_name: string } | null;
  } | null;

  if (!session) {
    return Response.json({
      valid: false,
      session: null,
      invoiceId: null,
      sessionId: null,
      error:
        "We couldn't load the class details for this invoice. Please contact your instructor.",
    });
  }

  const startsAt = new Date(session.starts_at);
  const instructorProfile = session.profiles;

  return Response.json({
    valid: true,
    invoiceId: invoice.id,
    sessionId: session.id,
    invoiceNumber: invoice.invoice_number,
    session: {
      className: session.class_types?.name ?? "CPR Class",
      date: startsAt.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      time: startsAt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      locationName: session.locations?.name ?? "",
      locationCity: session.locations?.city ?? "",
      locationState: session.locations?.state ?? "",
      instructorName: instructorProfile
        ? `${instructorProfile.first_name} ${instructorProfile.last_name}`
        : "",
    },
  });
}

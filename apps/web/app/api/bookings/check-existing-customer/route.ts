/**
 * POST /api/bookings/check-existing-customer
 * Called by: /book/details (public booking flow, "Your details" step)
 * Auth: none. The visitor is not signed in yet, so this is IP-rate-limited.
 * Body: { email: string, phone: string }
 * Returns { data: { exists: boolean }, error: null }.
 *
 * Tells the booking page whether the email, or failing that the phone number,
 * already belongs to an account, so the visitor can be sent to sign in instead
 * of creating a duplicate. It answers yes or no and nothing else.
 *
 * Why this is a server route: the page used to run these two lookups straight
 * from the browser against `profiles`, which only worked because an RLS policy
 * let the public API key read every row and every column of that table. That
 * policy exposed every customer's and staff member's contact details to anyone,
 * so it was removed (migration 0080) and the lookup moved here, behind the
 * service-role client.
 *
 * Match rules are unchanged from the browser version: exact email, then exact
 * phone, and a phone shared by more than one profile counts as no match.
 * Side effects: none (read-only).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

/** Longest email address allowed by RFC 5321. */
const MAX_EMAIL_LENGTH = 254;
/** Generous cap on a phone string; rejects obvious abuse without refusing real formats. */
const MAX_PHONE_LENGTH = 40;

/**
 * 30 lookups per IP per hour. A customer correcting typos needs a handful; this
 * leaves headroom for a shared office or school network while making it
 * impractical to enumerate addresses from one machine.
 */
const allowLookup = createRateLimiter({ max: 30, windowMs: 60 * 60 * 1000 });

/**
 * Reports whether an account already exists for the given email or phone.
 * @param request - POST request with a JSON body `{ email, phone }`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!allowLookup(getClientIp(request))) {
    return Response.json(
      { data: null, error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ data: null, error: "Invalid request." }, { status: 400 });
  }

  const raw = body as { email?: unknown; phone?: unknown } | null;
  const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
  const phone = typeof raw?.phone === "string" ? raw.phone.trim() : "";

  if (
    !email ||
    email.length > MAX_EMAIL_LENGTH ||
    !/\S+@\S+\.\S+/.test(email) ||
    !phone ||
    phone.length > MAX_PHONE_LENGTH
  ) {
    return Response.json({ data: null, error: "Invalid request." }, { status: 400 });
  }

  const admin = await createAdminClient();

  // limit(2) so "exactly one match" can be told apart from "several" without
  // relying on PostgREST's single-row error code. Only the id is selected.
  const byEmail = await admin.from("profiles").select("id").eq("email", email).limit(2);
  if (byEmail.error) {
    console.error("[check-existing-customer] Email lookup failed:", byEmail.error.message);
    return Response.json({ data: null, error: "Lookup failed." }, { status: 500 });
  }
  if (byEmail.data.length === 1) {
    return Response.json({ data: { exists: true }, error: null });
  }

  const byPhone = await admin.from("profiles").select("id").eq("phone", phone).limit(2);
  if (byPhone.error) {
    console.error("[check-existing-customer] Phone lookup failed:", byPhone.error.message);
    return Response.json({ data: null, error: "Lookup failed." }, { status: 500 });
  }

  return Response.json({ data: { exists: byPhone.data.length === 1 }, error: null });
}

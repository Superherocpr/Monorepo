/**
 * GET  /api/class-requests — list class requests
 * POST /api/class-requests — submit a new customer class request
 *
 * GET Auth: Staff (manager/super_admin) see all requests with customer info.
 *           Authenticated customers see only their own requests.
 * POST Auth: Any authenticated user (customer or staff).
 *
 * POST side effects:
 *   1. Inserts a class_requests row (status = 'pending', travel_fee = 65)
 *   2. Emails all super_admin and manager profiles (admin notification)
 *   3. Emails the submitting customer (confirmation)
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  classRequestAdminNotificationEmail,
  classRequestCustomerConfirmEmail,
} from "@/lib/emails";
import { PREFERRED_TIME_LABELS } from "@/types/class-requests";
import type { PreferredTimeOfDay } from "@/types/class-requests";

/** Valid US state abbreviations. */
const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

/** Valid time-of-day values for the preferred_time_of_day field. */
const VALID_TIMES = new Set<PreferredTimeOfDay>(["morning","afternoon","evening","flexible"]);

/**
 * Lists class requests.
 * - super_admin / manager: returns all requests joined with class type and customer name.
 * - authenticated customer: returns only their own requests.
 * - unauthenticated: 401.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  const admin = await createAdminClient();

  // Load caller's profile to determine role
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = profile.role === "manager" || profile.role === "super_admin";

  let query = admin
    .from("class_requests")
    .select(`
      id, customer_id, class_type_id, preferred_date,
      preferred_time_of_day, group_size, contact_phone,
      venue_name, venue_address, venue_city, venue_state, venue_zip,
      notes, status, rejection_reason, travel_fee, session_id, created_at,
      class_types ( id, name, duration_minutes, price ),
      profiles ( id, first_name, last_name, email )
    `)
    .order("created_at", { ascending: false });

  // Customers only see their own requests
  if (!isAdmin) {
    query = query.eq("customer_id", user.id) as typeof query;
  }

  const { data, error } = await query;

  if (error) {
    console.error("[class-requests GET] DB error:", error);
    return NextResponse.json({ data: null, error: "Failed to load requests" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * Creates a new customer class request.
 * Validates all required fields, inserts a class_requests row, then sends
 * notification emails to all admins/managers and a confirmation to the customer.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ data: null, error: "Invalid request body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  // ── Validate required fields ───────────────────────────────────────────────
  const {
    class_type_id,
    preferred_date,
    preferred_time_of_day,
    group_size,
    contact_phone,
    venue_name,
    venue_address,
    venue_city,
    venue_state,
    venue_zip,
    notes,
  } = b;

  if (
    typeof class_type_id !== "string" || !class_type_id.trim() ||
    typeof preferred_date !== "string" || !preferred_date.trim() ||
    typeof preferred_time_of_day !== "string" ||
    !VALID_TIMES.has(preferred_time_of_day as PreferredTimeOfDay) ||
    typeof group_size !== "number" || !Number.isInteger(group_size) || group_size < 1 ||
    typeof contact_phone !== "string" || !contact_phone.trim() ||
    typeof venue_name !== "string" || !venue_name.trim() ||
    typeof venue_address !== "string" || !venue_address.trim() ||
    typeof venue_city !== "string" || !venue_city.trim() ||
    typeof venue_state !== "string" || !VALID_STATES.has(venue_state) ||
    typeof venue_zip !== "string" || !venue_zip.trim()
  ) {
    return NextResponse.json(
      { data: null, error: "Missing or invalid required fields" },
      { status: 400 }
    );
  }

  // Preferred date must be at least 7 days from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 7);
  const requestedDate = new Date(preferred_date + "T00:00:00");
  if (requestedDate < minDate) {
    return NextResponse.json(
      { data: null, error: "Preferred date must be at least 7 days from today" },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  // Verify class_type exists and is active
  const { data: classType } = await admin
    .from("class_types")
    .select("id, name, duration_minutes")
    .eq("id", class_type_id.trim())
    .eq("active", true)
    .single();

  if (!classType) {
    return NextResponse.json(
      { data: null, error: "Invalid class type" },
      { status: 400 }
    );
  }

  // Load caller profile for name/email used in emails
  const { data: profile } = await admin
    .from("profiles")
    .select("id, first_name, last_name, email")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ data: null, error: "Profile not found" }, { status: 500 });
  }

  // ── Insert class_requests row ─────────────────────────────────────────────
  const { data: newRequest, error: insertError } = await admin
    .from("class_requests")
    .insert({
      customer_id: user.id,
      class_type_id: class_type_id.trim(),
      preferred_date: preferred_date.trim(),
      preferred_time_of_day: preferred_time_of_day as PreferredTimeOfDay,
      group_size: group_size,
      contact_phone: (contact_phone as string).trim(),
      venue_name: venue_name.trim(),
      venue_address: venue_address.trim(),
      venue_city: venue_city.trim(),
      venue_state: venue_state.trim(),
      venue_zip: venue_zip.trim(),
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      status: "pending",
      travel_fee: 65,
    })
    .select("id")
    .single();

  if (insertError || !newRequest) {
    console.error("[class-requests POST] Insert error:", insertError);
    return NextResponse.json(
      { data: null, error: "Failed to create class request" },
      { status: 500 }
    );
  }

  // ── Send emails via Resend (best-effort) ──────────────────────────────────
  if (!process.env.RESEND_API_KEY) {
    console.warn("[class-requests POST] RESEND_API_KEY not set — skipping emails");
    return NextResponse.json({ data: { id: newRequest.id } });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  // Fetch all managers and super admins to notify
  const { data: adminProfiles } = await admin
    .from("profiles")
    .select("email, first_name")
    .in("role", ["super_admin", "manager"])
    .eq("deactivated", false);

  const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean);

  const timeLabel = PREFERRED_TIME_LABELS[preferred_time_of_day as PreferredTimeOfDay];
  const customerFullName = `${profile.first_name} ${profile.last_name}`;

  const adminEmail = classRequestAdminNotificationEmail({
    customerName: customerFullName,
    customerEmail: profile.email,
    className: classType.name,
    preferredDate: preferred_date.trim(),
    preferredTimeLabel: timeLabel,
    groupSize: group_size,
    venueName: venue_name.trim(),
    venueCity: venue_city.trim(),
    venueState: venue_state.trim(),
    requestId: newRequest.id,
    baseUrl,
  });

  const confirmEmail = classRequestCustomerConfirmEmail({
    firstName: profile.first_name,
    className: classType.name,
    preferredDate: preferred_date.trim(),
    venueName: venue_name.trim(),
  });

  const emailSends: Promise<unknown>[] = [
    resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: profile.email,
      subject: confirmEmail.subject,
      html: confirmEmail.html,
    }),
  ];

  // Fan-out to all admins/managers
  if (adminEmails.length > 0) {
    emailSends.push(
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: adminEmails,
        subject: adminEmail.subject,
        html: adminEmail.html,
      })
    );
  }

  const results = await Promise.all(emailSends);
  results.forEach((r, i) => {
    if (r && typeof r === "object" && "error" in r && r.error) {
      console.error(`[class-requests POST] Email send ${i} failed:`, r.error);
    }
  });

  return NextResponse.json({ data: { id: newRequest.id } });
}

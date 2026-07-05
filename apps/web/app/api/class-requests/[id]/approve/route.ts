/**
 * POST /api/class-requests/[id]/approve
 * Called by: admin class-request detail page
 * Auth: manager, super_admin only
 *
 * Approves a pending class request by:
 *   1. Fetching the request, customer profile, and class type
 *   2. Creating a new locations row from the request's venue fields
 *   3. Creating a class_sessions row (approval_status='approved', instructor_id=NULL,
 *      travel_fee=65, class_request_id=request.id)
 *   4. Updating class_requests: status='approved', session_id=newSession.id
 *   5. Emailing the customer that their request was approved
 *   6. Emailing all active instructors with the class opportunity (first-come-first-serve)
 *
 * Returns { data: { sessionId } } on success.
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import {
  classRequestApprovedCustomerEmail,
  instructorClassOpportunityEmail,
} from "@/lib/emails";
import { PREFERRED_TIME_LABELS } from "@/types/class-requests";
import type { PreferredTimeOfDay } from "@/types/class-requests";

/** Route handler params from the dynamic [id] segment. */
interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Approves a class request: creates a location and session, then notifies
 * the customer and all available instructors.
 */
export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await params;

  const admin = await createAdminClient();

  // Load the request with all needed join data
  const { data: classRequest } = await admin
    .from("class_requests")
    .select(`
      id, status, preferred_date, preferred_time_of_day,
      group_size, venue_name, venue_address, venue_city, venue_state, venue_zip,
      travel_fee, customer_id, class_type_id,
      class_types ( id, name, duration_minutes, max_capacity, price ),
      profiles ( id, first_name, last_name, email )
    `)
    .eq("id", id)
    .single();

  if (!classRequest) {
    return NextResponse.json(
      { data: null, error: "Class request not found" },
      { status: 404 }
    );
  }

  if (classRequest.status !== "pending") {
    return NextResponse.json(
      { data: null, error: "Only pending requests can be approved" },
      { status: 409 }
    );
  }

  // Type-narrow the joined data (Supabase returns arrays for joins; cast through unknown)
  const classType = classRequest.class_types as unknown as {
    id: string;
    name: string;
    duration_minutes: number;
    max_capacity: number;
    price: number;
  } | null;

  const customer = classRequest.profiles as unknown as {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;

  if (!classType || !customer) {
    return NextResponse.json(
      { data: null, error: "Request data is incomplete" },
      { status: 500 }
    );
  }

  // ── 1. Create a location row from the venue fields ─────────────────────────
  const { data: newLocation, error: locationError } = await admin
    .from("locations")
    .insert({
      name: classRequest.venue_name,
      address: classRequest.venue_address,
      city: classRequest.venue_city,
      state: classRequest.venue_state,
      zip: classRequest.venue_zip,
      is_home_base: false,
      notes: null,
    })
    .select("id")
    .single();

  if (locationError || !newLocation) {
    console.error("[class-requests/approve] Failed to create location:", locationError);
    return NextResponse.json(
      { data: null, error: "Failed to create location" },
      { status: 500 }
    );
  }

  // ── 2. Create a class_sessions row ─────────────────────────────────────────
  // Use noon UTC on the preferred date as the default start time so the session
  // appears on the correct calendar day. Admins can adjust the time afterward.
  const startsAt = new Date(`${classRequest.preferred_date}T12:00:00Z`);
  const endsAt = new Date(startsAt.getTime() + classType.duration_minutes * 60 * 1000);

  const { data: newSession, error: sessionError } = await admin
    .from("class_sessions")
    .insert({
      class_type_id: classRequest.class_type_id,
      location_id: newLocation.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      max_capacity: classType.max_capacity,
      status: "scheduled",
      // Approved immediately — no second approval loop needed for customer-requested sessions.
      approval_status: "approved",
      instructor_id: null,
      travel_fee: classRequest.travel_fee,
      class_request_id: classRequest.id,
    })
    .select("id")
    .single();

  if (sessionError || !newSession) {
    console.error("[class-requests/approve] Failed to create session:", sessionError);
    // Roll back the location to avoid orphaned rows
    await admin.from("locations").delete().eq("id", newLocation.id);
    return NextResponse.json(
      { data: null, error: "Failed to create class session" },
      { status: 500 }
    );
  }

  // ── 3. Update class_requests row ───────────────────────────────────────────
  const { error: updateError } = await admin
    .from("class_requests")
    .update({ status: "approved", session_id: newSession.id })
    .eq("id", id);

  if (updateError) {
    console.error("[class-requests/approve] Failed to update request status:", updateError);
    // Non-fatal — session is created; surface warning but proceed with emails.
  }

  // ── 4. Send emails via Resend (best-effort) ────────────────────────────────
  if (!process.env.RESEND_API_KEY) {
    console.warn("[class-requests/approve] RESEND_API_KEY not set — skipping emails");
    return NextResponse.json({ data: { sessionId: newSession.id } });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  const timeLabel =
    PREFERRED_TIME_LABELS[classRequest.preferred_time_of_day as PreferredTimeOfDay] ??
    classRequest.preferred_time_of_day;

  const approvedEmail = classRequestApprovedCustomerEmail({
    firstName: customer.first_name,
    className: classType.name,
    confirmedDate: classRequest.preferred_date,
    venueName: classRequest.venue_name,
  });

  const opportunityEmail = instructorClassOpportunityEmail({
    className: classType.name,
    confirmedDate: classRequest.preferred_date,
    preferredTimeLabel: timeLabel,
    groupSize: classRequest.group_size,
    venueName: classRequest.venue_name,
    venueCity: classRequest.venue_city,
    venueState: classRequest.venue_state,
    sessionId: newSession.id,
    baseUrl,
  });

  // Fetch all active instructors (instructor, manager, super_admin)
  const { data: instructorProfiles } = await admin
    .from("profiles")
    .select("email")
    .in("role", ["instructor", "manager", "super_admin"])
    .eq("deactivated", false);

  const instructorEmails = (instructorProfiles ?? [])
    .map((p) => p.email)
    .filter(Boolean);

  const emailSends: Promise<unknown>[] = [
    resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: customer.email,
      subject: approvedEmail.subject,
      html: approvedEmail.html,
    }),
  ];

  if (instructorEmails.length > 0) {
    emailSends.push(
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: instructorEmails,
        subject: opportunityEmail.subject,
        html: opportunityEmail.html,
      })
    );
  }

  const results = await Promise.all(emailSends);
  results.forEach((r, i) => {
    if (r && typeof r === "object" && "error" in r && r.error) {
      console.error(`[class-requests/approve] Email send ${i} failed:`, r.error);
    }
  });

  return NextResponse.json({ data: { sessionId: newSession.id } });
}

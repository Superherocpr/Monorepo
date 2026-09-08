/**
 * POST /api/class-requests/[id]/approve
 * Called by: admin class-request detail page
 * Auth: manager, super_admin only
 *
 * Approves a pending class request by:
 *   1. Fetching the request, customer profile, and class type
 *   2. Resolving a session location — either a NEW locations row created from
 *      the request's venue fields (venue_mode = customer_venue), or the
 *      EXISTING home-base location it already points at (venue_mode =
 *      home_base). The home_base branch never creates a location: reusing the
 *      original is the whole point, otherwise every approval would leave
 *      behind a near-duplicate of the same address.
 *   3. Creating a class_sessions row (approval_status='approved', instructor_id=NULL,
 *      travel_fee=request's travel_fee, class_request_id=request.id)
 *   4. Updating class_requests: status='approved', session_id=newSession.id
 *   5. Emailing the customer that their request was approved
 *   6. Emailing all active instructors with the class opportunity (first-come-first-serve)
 *
 * Returns { data: { sessionId } } on success.
 */

import { NextResponse } from "next/server";
import { sendEmails, isEmailConfigured } from "@/lib/send-email";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import {
  classRequestApprovedCustomerEmail,
  instructorClassOpportunityEmail,
} from "@/lib/emails";
import { PREFERRED_TIME_LABELS } from "@/types/class-requests";
import type { PreferredTimeOfDay, VenueMode } from "@/types/class-requests";

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
      group_size, venue_mode, venue_location_id,
      venue_name, venue_address, venue_city, venue_state, venue_zip,
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

  // ── 1. Resolve the session location ─────────────────────────────────────────
  // home_base: reuse the existing location the customer picked — never create
  // a second copy of it. customer_venue: create a new location from the
  // freeform address, exactly as before.
  let sessionLocationId: string;
  /** Real, staff-facing venue name — shown to instructors, never to the customer. */
  let staffVenueLabel: string;
  /** Only set (and only rolled back) when this call created a brand-new location. */
  let createdLocationId: string | null = null;

  if ((classRequest.venue_mode as VenueMode) === "home_base") {
    if (!classRequest.venue_location_id) {
      return NextResponse.json(
        {
          data: null,
          error:
            "The home base location for this request no longer exists. It may have been deleted.",
        },
        { status: 409 }
      );
    }

    const { data: homeBaseLocation } = await admin
      .from("locations")
      .select("id, name")
      .eq("id", classRequest.venue_location_id)
      .maybeSingle();

    if (!homeBaseLocation) {
      return NextResponse.json(
        {
          data: null,
          error:
            "The home base location for this request no longer exists. It may have been deleted.",
        },
        { status: 409 }
      );
    }

    sessionLocationId = homeBaseLocation.id;
    staffVenueLabel = homeBaseLocation.name;
  } else {
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

    sessionLocationId = newLocation.id;
    createdLocationId = newLocation.id;
    // customer_venue rows always carry a real venue_name — enforced by the
    // class_requests_venue_shape_check constraint.
    staffVenueLabel = classRequest.venue_name as string;
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
      location_id: sessionLocationId,
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
    // Roll back only a location this call created — a home base is reused,
    // never ours to delete.
    if (createdLocationId) {
      await admin.from("locations").delete().eq("id", createdLocationId);
    }
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

  // ── 4. Send emails (best-effort) ───────────────────────────────────────────
  // The session already exists; skip the instructor lookup when no mail could
  // be sent anyway.
  if (!isEmailConfigured()) {
    console.warn("[class-requests/approve] Resend not configured — skipping emails");
    return NextResponse.json({ data: { sessionId: newSession.id } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  const timeLabel =
    PREFERRED_TIME_LABELS[classRequest.preferred_time_of_day as PreferredTimeOfDay] ??
    classRequest.preferred_time_of_day;

  // customer_venue rows already carry a real venue_name; home_base rows never
  // reveal the location's internal name to the customer.
  const customerVenueLabel =
    (classRequest.venue_mode as VenueMode) === "home_base"
      ? `Our ${classRequest.venue_city} location`
      : (classRequest.venue_name as string);

  const approvedEmail = classRequestApprovedCustomerEmail({
    firstName: customer.first_name,
    className: classType.name,
    confirmedDate: classRequest.preferred_date,
    venueName: customerVenueLabel,
  });

  const opportunityEmail = instructorClassOpportunityEmail({
    className: classType.name,
    confirmedDate: classRequest.preferred_date,
    preferredTimeLabel: timeLabel,
    groupSize: classRequest.group_size,
    venueName: staffVenueLabel,
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

  await sendEmails([
    {
      context: "class-requests/approve:customer",
      to: customer.email,
      subject: approvedEmail.subject,
      html: approvedEmail.html,
      idempotencyKey: `class-request-approved-${newSession.id}`,
    },
    ...(instructorEmails.length > 0
      ? [
          {
            context: "class-requests/approve:instructor-opportunity",
            to: instructorEmails,
            subject: opportunityEmail.subject,
            html: opportunityEmail.html,
            idempotencyKey: `class-request-opportunity-${newSession.id}`,
          },
        ]
      : []),
  ]);

  return NextResponse.json({ data: { sessionId: newSession.id } });
}

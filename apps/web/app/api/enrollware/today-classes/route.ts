/**
 * GET /api/enrollware/today-classes
 * Called by: Enrollware bookmarklet (cross-origin from enrollware.com)
 * Auth: Bearer API key (validated against api_keys table via enrollware-api-auth)
 *
 * Returns today's class sessions for the authenticated instructor, with joined
 * class type, location, instructor name, and full roster of students.
 *
 * "Today" is computed in the instructor's local timezone (passed as ?tz=<IANA>
 * by the bookmarklet) — falling back to America/New_York (the business's
 * Eastern timezone). This prevents the UTC-day-rollover bug where evening
 * usage would otherwise miss the day's classes.
 *
 * Classes already marked enrollware_submitted are included but flagged so the
 * bookmarklet UI can distinguish submitted from pending.
 *
 * Handles OPTIONS preflight for CORS.
 */

import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  validateEnrollwareKey,
  enrollwareCorsHeaders,
  localDayWindow,
} from "@/lib/enrollware-api-auth";

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: enrollwareCorsHeaders(origin),
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("Origin");
  const cors = enrollwareCorsHeaders(origin);

  // Validate the Bearer API key
  const auth = await validateEnrollwareKey(request);
  if (!auth.ok) {
    // Re-wrap the auth failure so we attach CORS headers without losing the
    // original Content-Type / status from validateEnrollwareKey.
    const body = await auth.response.text();
    return new Response(body, {
      status: auth.response.status,
      headers: {
        "Content-Type": auth.response.headers.get("Content-Type") ?? "application/json",
        ...cors,
      },
    });
  }

  const { profileId } = auth;
  const admin = await createAdminClient();

  // Resolve the local-day window for the instructor. The bookmarklet passes
  // ?tz=<IANA> from the browser; otherwise we default to the business's
  // Eastern timezone (see DEFAULT_INSTRUCTOR_TZ).
  const tzParam = request.nextUrl.searchParams.get("tz");
  const { startIso, endIso } = localDayWindow(tzParam);

  // Fetch today's sessions for this instructor with all data the bookmarklet needs.
  // roster_records are returned as a nested array via Supabase's foreign key relation.
  const { data: sessions, error } = await admin
    .from("class_sessions")
    .select(
      `id,
       starts_at,
       ends_at,
       max_capacity,
       enrollware_submitted,
       class_types ( name, price, duration_minutes ),
       locations ( name ),
       profiles!class_sessions_instructor_id_fkey ( first_name, last_name ),
       roster_records ( first_name, last_name, email, phone, address_1, address_2, city, state, zip, grade, bookings ( profiles!bookings_customer_id_fkey ( address, city, state, zip ) ) )`
    )
    .eq("instructor_id", profileId)
    .gte("starts_at", startIso)
    .lte("starts_at", endIso)
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("[enrollware/today-classes] Query error:", error.message);
    return Response.json(
      { error: "Failed to load classes." },
      { status: 500, headers: cors }
    );
  }

  // Reshape Supabase's nested relation format into a clean API response shape.
  // Supabase returns joined single-record relations as an object (not array).
  const classes = (sessions ?? []).map((s) => {
    const classType = Array.isArray(s.class_types) ? s.class_types[0] : s.class_types;
    const location = Array.isArray(s.locations) ? s.locations[0] : s.locations;
    const instructor = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      max_capacity: s.max_capacity,
      enrollware_submitted: s.enrollware_submitted ?? false,
      class_type: classType
        ? {
            name: classType.name,
            price: classType.price,
            duration_minutes: classType.duration_minutes,
          }
        : null,
      location: location ? { name: location.name } : null,
      instructor: instructor
        ? {
            first_name: instructor.first_name,
            last_name: instructor.last_name,
          }
        : null,
      // Each student row — address fields fall back to the linked profile when
      // the roster_record was created before address capture was added.
      students: (s.roster_records ?? []).map(
        (r: {
          first_name: string;
          last_name: string;
          email: string | null;
          phone: string | null;
          address_1: string | null;
          address_2: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          grade: number | null;
          bookings: {
            profiles: { address: string | null; city: string | null; state: string | null; zip: string | null }[] | null;
          }[] | null;
        }) => {
          // Prefer the roster_record's own address (set at check-in); fall back
          // to the profile's saved address for students who checked in before
          // address capture was added to the rollcall flow.
          // Supabase returns nested relations as arrays — unwrap one level each.
          const booking = Array.isArray(r.bookings) ? r.bookings[0] : (r.bookings ?? null);
          const rawProfiles = booking?.profiles;
          const profileAddr = Array.isArray(rawProfiles) ? (rawProfiles[0] ?? null) : (rawProfiles ?? null);
          return {
            first_name: r.first_name,
            last_name: r.last_name,
            email: r.email,
            phone: r.phone,
            address_1: r.address_1 ?? profileAddr?.address ?? null,
            address_2: r.address_2 ?? null,
            city: r.city ?? profileAddr?.city ?? null,
            state: r.state ?? profileAddr?.state ?? null,
            zip: r.zip ?? profileAddr?.zip ?? null,
            grade: r.grade,
          };
        }
      ),
    };
  });

  return Response.json({ classes }, { status: 200, headers: cors });
}

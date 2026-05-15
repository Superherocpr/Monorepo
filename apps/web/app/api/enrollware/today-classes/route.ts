/**
 * GET /api/enrollware/today-classes
 * Called by: Enrollware bookmarklet (cross-origin from enrollware.com)
 * Auth: Bearer API key (validated against api_keys table via enrollware-api-auth)
 *
 * Returns today's class sessions for the authenticated instructor, with joined
 * class type, location, instructor name, and full roster of students.
 * "Today" is defined as the current calendar date in UTC (00:00–23:59 UTC).
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
    return new Response(auth.response.body, {
      status: auth.response.status,
      headers: { ...Object.fromEntries(auth.response.headers), ...cors },
    });
  }

  const { profileId } = auth;
  const admin = await createAdminClient();

  // Compute today's date window in UTC
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

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
       roster_records ( first_name, last_name, email, phone, address_1, address_2, city, state, zip )`
    )
    .eq("instructor_id", profileId)
    .gte("starts_at", todayStart.toISOString())
    .lte("starts_at", todayEnd.toISOString())
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
      // Each student row — address fields may be null if not collected at signup
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
        }) => ({
          first_name: r.first_name,
          last_name: r.last_name,
          email: r.email,
          phone: r.phone,
          address_1: r.address_1,
          address_2: r.address_2,
          city: r.city,
          state: r.state,
          zip: r.zip,
        })
      ),
    };
  });

  return Response.json({ classes }, { status: 200, headers: cors });
}

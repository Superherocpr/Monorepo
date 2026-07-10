/**
 * GET /api/enrollware/student-xlsx
 * Called by: Enrollware bookmarklet when the student list panel is visible.
 * Auth: Bearer API key (validated against api_keys table via enrollware-api-auth)
 *
 * Fetches the student roster for the given ?sessionId, generates an Excel
 * (.xlsx) workbook in memory using SheetJS, and streams it back as a binary
 * response. Nothing is written to disk — the workbook exists only for the
 * duration of the request.
 *
 * Only succeeds when the session belongs to the authenticated instructor, so
 * one instructor cannot pull another instructor's roster.
 *
 * Column order matches the Enrollware sample import file:
 *   Last Name · First Name · Email Address · Phone · Address 1 · Address 2 ·
 *   City · State · Zip · Score · Status · License · Price · Codes
 *
 * Handles OPTIONS preflight for CORS.
 */

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/server";
import {
  validateEnrollwareKey,
  enrollwareCorsHeaders,
} from "@/lib/enrollware-api-auth";

export async function OPTIONS(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: enrollwareCorsHeaders(origin),
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = enrollwareCorsHeaders(origin);

  const auth = await validateEnrollwareKey(request);
  if (!auth.ok) {
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

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json(
      { error: "sessionId is required." },
      { status: 400, headers: cors }
    );
  }

  const admin = await createAdminClient();

  // Fetch the session's roster. The instructor_id check is the ownership gate —
  // it prevents one instructor from generating a roster for another's class.
  const { data: session, error } = await admin
    .from("class_sessions")
    .select(
      `id,
       roster_records (
         first_name, last_name, email, phone,
         address_1, address_2, city, state, zip, grade,
         bookings ( profiles!bookings_customer_id_fkey ( address, city, state, zip ) )
       )`
    )
    .eq("id", sessionId)
    .eq("instructor_id", profileId)
    .single();

  if (error || !session) {
    // Treat both "not found" and "not yours" as 404 — no information leakage
    console.error("[enrollware/student-xlsx] Query error:", error?.message);
    return Response.json(
      { error: "Session not found or not authorized." },
      { status: 404, headers: cors }
    );
  }

  // Resolve each student's address, falling back to the linked profile address
  // for older records created before address capture was added to rollcall.
  const rows = (session.roster_records ?? []).map(
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
      const booking = Array.isArray(r.bookings) ? r.bookings[0] : (r.bookings ?? null);
      const rawProfiles = booking?.profiles;
      const profileAddr = Array.isArray(rawProfiles) ? (rawProfiles[0] ?? null) : (rawProfiles ?? null);

      return [
        r.last_name   ?? "",
        r.first_name  ?? "",
        r.email       ?? "",
        r.phone       ?? "",
        r.address_1   ?? profileAddr?.address ?? "",
        r.address_2   ?? "",
        r.city        ?? profileAddr?.city    ?? "",
        r.state       ?? profileAddr?.state   ?? "",
        r.zip         ?? profileAddr?.zip     ?? "",
        r.grade != null ? r.grade : "",         // Score — numeric (e.g. 100)
        r.grade != null ? "Complete" : "",      // Status only set when graded
        "",  // License — managed by Enrollware
        "",  // Price   — managed by Enrollware
        "",  // Codes   — managed by Enrollware
      ];
    }
  );

  // Build the workbook. Column order must match the Enrollware import template.
  const header = [
    "Last Name", "First Name", "Email Address", "Phone",
    "Address 1", "Address 2", "City", "State", "Zip",
    "Score", "Status", "License", "Price", "Codes",
  ];

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");

  // Write to a Node Buffer — no temp file, lives only in memory
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="students.xlsx"',
      ...cors,
    },
  });
}

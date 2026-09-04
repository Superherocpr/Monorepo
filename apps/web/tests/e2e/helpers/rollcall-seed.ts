/**
 * rollcall-seed.ts — deterministic test data for the rollcall happy-path e2e.
 *
 * Creates (via the service-role Supabase client, bypassing RLS):
 *   - an instructor profile with a fresh 6-digit access code
 *   - a customer profile (the student)
 *   - an approved, in-progress class session starting "now" (always on
 *     today's business calendar day)
 *   - a non-cancelled booking linking the student to the session
 *
 * Reuses an existing class_type and location row rather than inserting new
 * ones, so admin dropdowns and the public schedule aren't polluted.
 * All created rows are removed by cleanupRollcallScenario.
 *
 * Env: needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — read
 * from process.env first (CI), then from apps/web/.env.local (local dev).
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { floatingNow, addFloatingMinutes } from "../../../lib/business-time";

/** Everything the spec needs to drive the flow and clean up afterwards. */
export interface SeededRollcall {
  /** The 6-digit access code the student types on step 1. */
  code: string;
  instructorId: string;
  sessionId: string;
  bookingId: string;
  student: {
    profileId: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

/**
 * Reads a single key from process.env, falling back to apps/web/.env.local.
 * Throws with a clear message when the key is missing from both. Exported so
 * specs needing a browser-facing (anon-key) client can resolve the same env
 * vars without duplicating the fallback logic.
 * @param key - env var name to resolve
 */
export function requireEnv(key: string): string {
  if (process.env[key]) return process.env[key]!;

  const envPath = path.join(__dirname, "../../../.env.local");
  if (fs.existsSync(envPath)) {
    const line = fs
      .readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim();
  }

  throw new Error(
    `[rollcall-seed] Missing ${key} — set it in the environment or apps/web/.env.local`
  );
}

/** Builds a service-role Supabase client for direct DB seeding. */
function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

/**
 * Seeds the full rollcall scenario and returns the handles needed by the test.
 * Side effects: inserts 2 profiles, 1 class_session, 1 booking.
 * The access code is random per run so concurrent runs can't collide.
 */
export async function seedRollcallScenario(): Promise<SeededRollcall> {
  const db = serviceClient();
  // Unique-per-run suffix keeps repeated/concurrent runs from colliding
  const run = Date.now().toString(36);
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

  // Reuse an existing class type and location (don't pollute dropdowns)
  const { data: classType } = await db
    .from("class_types")
    .select("id, duration_minutes")
    .eq("active", true)
    .limit(1)
    .single();
  const { data: location } = await db
    .from("locations")
    .select("id")
    .limit(1)
    .single();
  if (!classType || !location) {
    throw new Error(
      "[rollcall-seed] DB has no class_types/locations rows to reuse — seed the base data first."
    );
  }

  const instructorId = randomUUID();
  const studentId = randomUUID();
  const now = new Date();
  // starts_at must be a floating wall-clock value (Eastern time labelled Z) so
  // that verify-code's classDate filter matches it. Using now.toISOString() here
  // gives a true UTC timestamp whose calendar date diverges from businessDate(now)
  // between 00:00–04:00 UTC, which is when the nightly CI run fires.
  const floatingStart = floatingNow();

  const { error: instructorError } = await db.from("profiles").insert({
    id: instructorId,
    role: "instructor",
    first_name: "E2E-Instructor",
    last_name: `Rollcall-${run}`,
    email: `e2e-rollcall-instructor-${run}@test.superherocpr.com`,
    phone: "5550000001",
    deactivated: false,
    daily_access_code: code,
    access_code_generated_at: now.toISOString(),
  });
  if (instructorError) {
    throw new Error(`[rollcall-seed] instructor insert failed: ${instructorError.message}`);
  }

  const student = {
    profileId: studentId,
    firstName: "E2E-Student",
    lastName: `Rollcall-${run}`,
    email: `e2e-rollcall-student-${run}@test.superherocpr.com`,
  };
  const { error: studentError } = await db.from("profiles").insert({
    id: studentId,
    role: "customer",
    first_name: student.firstName,
    last_name: student.lastName,
    email: student.email,
    phone: "5550000002",
    deactivated: false,
  });
  if (studentError) {
    throw new Error(`[rollcall-seed] student insert failed: ${studentError.message}`);
  }

  // starts_at must match the floating wall-clock convention: verify-code filters
  // with classDate(starts_at) === businessDate(now), where classDate slices the
  // literal YYYY-MM-DD from the stored string. A true UTC instant diverges from
  // the Eastern calendar date between 00:00–04:00 UTC, so floatingNow() is used.
  const { data: session, error: sessionError } = await db
    .from("class_sessions")
    .insert({
      class_type_id: classType.id,
      location_id: location.id,
      instructor_id: instructorId,
      starts_at: floatingStart,
      ends_at: addFloatingMinutes(floatingStart, 4 * 60),
      max_capacity: 10,
      status: "in_progress",
      approval_status: "approved",
    })
    .select("id")
    .single();
  if (sessionError || !session) {
    throw new Error(`[rollcall-seed] session insert failed: ${sessionError?.message}`);
  }

  const { data: booking, error: bookingError } = await db
    .from("bookings")
    .insert({
      session_id: session.id,
      customer_id: studentId,
      booking_source: "online",
      cancelled: false,
    })
    .select("id")
    .single();
  if (bookingError || !booking) {
    throw new Error(`[rollcall-seed] booking insert failed: ${bookingError?.message}`);
  }

  return {
    code,
    instructorId,
    sessionId: session.id,
    bookingId: booking.id,
    student,
  };
}

/**
 * Fetches the roster_record created by the check-in, so the spec can assert
 * confirmed=true landed in the DB (the signal the admin Verified column uses).
 * @param seed - handles returned by seedRollcallScenario
 */
export async function fetchRosterRecord(
  seed: SeededRollcall
): Promise<{ confirmed: boolean } | null> {
  const db = serviceClient();
  const { data } = await db
    .from("roster_records")
    .select("confirmed")
    .eq("session_id", seed.sessionId)
    .eq("booking_id", seed.bookingId)
    .maybeSingle();
  return data;
}

/**
 * Deletes every row the seed created (roster_records first — they reference
 * the booking/session). Safe to call even if the run failed partway.
 * @param seed - handles returned by seedRollcallScenario
 */
export async function cleanupRollcallScenario(seed: SeededRollcall): Promise<void> {
  const db = serviceClient();
  await db.from("roster_records").delete().eq("session_id", seed.sessionId);
  await db.from("bookings").delete().eq("id", seed.bookingId);
  await db.from("class_sessions").delete().eq("id", seed.sessionId);
  await db.from("profiles").delete().in("id", [seed.instructorId, seed.student.profileId]);
}

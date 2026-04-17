/**
 * /schedule page — public class session browser with client-side filtering.
 * Server fetches all upcoming approved sessions and class types, passes to ScheduleClient.
 * Filtering is entirely client-side — no re-fetches on filter change.
 */

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import ScheduleHeroSection from "./_components/ScheduleHeroSection";
import ScheduleClient from "./_components/ScheduleClient";
import PrivateSessionCta from "./_components/PrivateSessionCta";
import type { ScheduleSession, ClassTypeOption } from "@/types/schedule";

export const metadata: Metadata = {
  title: "Class Schedule",
  description:
    "Browse upcoming CPR certification classes in the Tampa Bay area. AHA-certified BLS, Heartsaver, CPR+AED, and Pediatric CPR sessions available.",
};

interface SchedulePageProps {
  // In Next.js 15+, searchParams is a Promise
  searchParams: Promise<{ class?: string }>;
}

/** Renders the full /schedule page. */
export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  // Fetch all upcoming, approved, scheduled sessions with related data
  // CRITICAL: Must filter by both status = 'scheduled' AND approval_status = 'approved'
  // Sessions pending approval or rejected must NOT appear on the public schedule
  const { data: rawSessions } = await supabase
    .from("class_sessions")
    .select(`
      id,
      starts_at,
      ends_at,
      max_capacity,
      status,
      class_types (
        id,
        name,
        price,
        duration_minutes
      ),
      profiles (
        first_name,
        last_name
      ),
      locations (
        name,
        address,
        city,
        state,
        zip
      ),
      bookings (
        id,
        cancelled
      ),
      invoices (
        id,
        student_count,
        status
      )
    `)
    .eq("status", "scheduled")
    .eq("approval_status", "approved")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  // Fetch active class types for the filter bar
  const { data: classTypes } = await supabase
    .from("class_types")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Compute spots remaining for each session.
  // Invoice students count against capacity even before payment —
  // an unpaid invoice still reserves spots to prevent overbooking.
  const sessionsWithAvailability: ScheduleSession[] = (rawSessions ?? []).map(
    (session) => {
      const activeBookings = (
        session.bookings as Array<{ id: string; cancelled: boolean }>
      )
        .filter((b) => !b.cancelled)
        .length;

      const invoiceStudents = (
        session.invoices as Array<{
          id: string;
          student_count: number;
          status: string;
        }>
      )
        .filter((inv) => inv.status !== "cancelled")
        .reduce((sum, inv) => sum + inv.student_count, 0);

      const spotsRemaining =
        session.max_capacity - activeBookings - invoiceStudents;

      return {
        id: session.id,
        starts_at: session.starts_at,
        ends_at: session.ends_at,
        max_capacity: session.max_capacity,
        status: session.status,
        spotsRemaining: Math.max(spotsRemaining, 0),
        isFull: spotsRemaining <= 0,
        // Supabase returns joined single records as an object, not array — double cast required
        class_types: session.class_types as unknown as ScheduleSession["class_types"],
        profiles: session.profiles as unknown as ScheduleSession["profiles"],
        locations: session.locations as unknown as ScheduleSession["locations"],
      };
    }
  );

  return (
    <main>
      <ScheduleHeroSection />
      <ScheduleClient
        sessions={sessionsWithAvailability}
        classTypes={(classTypes ?? []) as ClassTypeOption[]}
        initialClassFilter={params.class ?? null}
      />
      <PrivateSessionCta />
    </main>
  );
}

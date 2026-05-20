/**
 * /book page — Step 1 of the booking wizard: select a class session.
 * Server component: fetches approved, scheduled sessions and active class types.
 * Passes pre-selection from ?session= and ?class= query params to the client component.
 */

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BookSessionSelector from "./_components/BookSessionSelector";
import type { ScheduleSession, ClassTypeOption } from "@/types/schedule";

export const metadata: Metadata = {
  title: "Book a Class — SuperHeroCPR",
  description:
    "Select an upcoming CPR certification class and book your spot online.",
};

interface BookPageProps {
  /** Next.js 15+: searchParams is a Promise */
  searchParams: Promise<{ session?: string; class?: string }>;
}

/** Renders Step 1 of the booking wizard (session selection). */
export default async function BookPage({ searchParams }: BookPageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  // CRITICAL: Must filter by both status = 'scheduled' AND approval_status = 'approved'
  // Sessions pending approval or rejected are not publicly bookable
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

  // Fetch active class types for filter pills
  const { data: classTypes } = await supabase
    .from("class_types")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Compute spotsRemaining for each session.
  // Invoice students count against capacity even before payment —
  // an unpaid invoice still reserves spots to prevent overbooking.
  const sessions: ScheduleSession[] = (rawSessions ?? []).map((session) => {
    const raw = session as typeof session & {
      class_types: ScheduleSession["class_types"] | ScheduleSession["class_types"][];
      profiles: ScheduleSession["profiles"] | ScheduleSession["profiles"][];
      locations: ScheduleSession["locations"] | ScheduleSession["locations"][];
      bookings: Array<{ id: string; cancelled: boolean }>;
      invoices: Array<{ id: string; student_count: number; status: string }>;
    };

    const classType = (Array.isArray(raw.class_types) ? raw.class_types[0] : raw.class_types) as ScheduleSession["class_types"];
    const profile = (Array.isArray(raw.profiles) ? raw.profiles[0] : raw.profiles) as ScheduleSession["profiles"];
    const location = (Array.isArray(raw.locations) ? raw.locations[0] : raw.locations) as ScheduleSession["locations"];

    const activeBookings = (raw.bookings ?? []).filter((b) => !b.cancelled).length;
    const invoiceStudents = (raw.invoices ?? [])
      .filter((inv) => inv.status !== "cancelled")
      .reduce((sum, inv) => sum + inv.student_count, 0);
    const spotsRemaining = session.max_capacity - activeBookings - invoiceStudents;

    return {
      id: session.id,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      max_capacity: session.max_capacity,
      status: session.status,
      class_types: classType,
      profiles: profile,
      locations: location,
      spotsRemaining: Math.max(0, spotsRemaining),
      isFull: spotsRemaining <= 0,
    };
  });

  return (
    <BookSessionSelector
      sessions={sessions}
      classTypes={(classTypes ?? []) as ClassTypeOption[]}
      preSelectedSessionId={params.session ?? null}
      preSelectedClassSlug={params.class ?? null}
    />
  );
}

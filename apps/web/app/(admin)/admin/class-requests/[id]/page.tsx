/**
 * Admin Class Request detail page: /admin/class-requests/[id]
 * Access: manager and super_admin only.
 * Shows full request details and provides Approve / Reject actions for pending requests.
 * Auth guard is handled by app/(admin)/layout.tsx.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import ClassRequestDetailClient from "./_components/ClassRequestDetailClient";
import type { ClassRequest } from "@/types/class-requests";

/** Props passed to Next.js dynamic route pages. */
interface PageProps {
  params: Promise<{ id: string }>;
}

/** Fetches a single class request with all related data and renders the detail view. */
export default async function ClassRequestDetailPage({ params }: PageProps) {
  const { id } = await params;

  const actor = await getAdminActor();
  if (!actor || !["manager", "super_admin"].includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  const admin = await createAdminClient();

  const { data: raw } = await admin
    .from("class_requests")
    .select(`
      id, customer_id, class_type_id, preferred_date, preferred_time_of_day,
      group_size, venue_name, venue_address, venue_city, venue_state, venue_zip,
      notes, status, rejection_reason, travel_fee, session_id, created_at,
      class_types ( id, name, duration_minutes, price ),
      profiles ( id, first_name, last_name, email )
    `)
    .eq("id", id)
    .single();

  if (!raw) redirect("/admin/class-requests");

  const request = raw as unknown as ClassRequest;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <Link
          href="/admin/class-requests"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4"
        >
          ← Back to Customer Requests
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Class Request Detail</h1>
      </div>

      <ClassRequestDetailClient request={request} />
    </div>
  );
}

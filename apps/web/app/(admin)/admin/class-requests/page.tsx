/**
 * Admin Customer Requests page: /admin/class-requests
 * Access: manager and super_admin only.
 * Lists all customer-submitted class requests with status filtering.
 * Auth guard is handled by app/(admin)/layout.tsx.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import type { ClassRequest, ClassRequestStatus } from "@/types/class-requests";
import { CLASS_REQUEST_STATUS_LABELS } from "@/types/class-requests";

export const metadata = {
  title: "Customer Requests | Admin | SuperHeroCPR",
};

/** Valid status filter values for the query param. */
const VALID_STATUSES = new Set<ClassRequestStatus>([
  "pending", "approved", "rejected", "instructor_assigned",
]);

/** Badge colour mapping per status. */
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-700",
  instructor_assigned: "bg-green-100 text-green-800",
};

/** Page props including optional ?status= search param. */
interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

/** Formats an ISO date string as a short date. */
function formatDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Admin class request list page. */
export default async function ClassRequestsAdminPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const actor = await getAdminActor();
  if (!actor || !["manager", "super_admin"].includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  const statusFilter = VALID_STATUSES.has(params.status as ClassRequestStatus)
    ? (params.status as ClassRequestStatus)
    : null;

  const admin = await createAdminClient();

  let query = admin
    .from("class_requests")
    .select(`
      id, preferred_date, group_size,
      venue_name, venue_city, venue_state,
      status, travel_fee, created_at,
      class_types ( id, name ),
      profiles ( id, first_name, last_name, email )
    `)
    .order("created_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter) as typeof query;
  }

  const { data: rawRequests } = await query;
  const requests = (rawRequests ?? []) as unknown as ClassRequest[];

  const pendingCount = statusFilter === null
    ? requests.filter((r) => r.status === "pending").length
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Requests</h1>
        <p className="text-sm text-gray-500 mt-1">
          Customer-submitted requests for classes at their location. Review and approve or reject each request.
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {([null, "pending", "approved", "instructor_assigned", "rejected"] as (ClassRequestStatus | null)[]).map(
          (status) => {
            const isActive = status === statusFilter;
            const label = status === null ? "All" : CLASS_REQUEST_STATUS_LABELS[status];
            const href = status === null ? "/admin/class-requests" : `/admin/class-requests?status=${status}`;
            return (
              <Link
                key={status ?? "all"}
                href={href}
                className={[
                  "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                  isActive
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-400",
                ].join(" ")}
              >
                {label}
              </Link>
            );
          }
        )}
        {pendingCount !== null && pendingCount > 0 && (
          <span className="ml-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-semibold self-center">
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Request list */}
      {requests.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg font-medium">No requests found</p>
          <p className="text-sm mt-1">
            {statusFilter ? `No ${CLASS_REQUEST_STATUS_LABELS[statusFilter].toLowerCase()} requests.` : "No customer requests have been submitted yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const statusLabel = CLASS_REQUEST_STATUS_LABELS[req.status] ?? req.status;
            const statusStyle = STATUS_STYLES[req.status] ?? "bg-gray-100 text-gray-700";
            const customer = req.profiles;

            return (
              <Link
                key={req.id}
                href={`/admin/class-requests/${req.id}`}
                className="block bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-gray-400 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {req.class_types?.name ?? "Unknown Class"}
                      </h3>
                      <span className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-3">
                      {customer
                        ? `${customer.first_name} ${customer.last_name}, ${customer.email}`
                        : "Unknown customer"}
                    </p>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                      <span>
                        📅 {formatDate(req.preferred_date)}
                      </span>
                      <span>
                        📍 {req.venue_name}, {req.venue_city}, {req.venue_state}
                      </span>
                      <span>
                        👥 ~{req.group_size} attendees
                      </span>
                      <span className="font-medium text-gray-700">
                        Travel fee: ${Number(req.travel_fee).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-gray-400 text-right">
                    {new Date(req.created_at).toLocaleDateString("en-US", {
                      month: "short", day: "numeric",
                    })}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

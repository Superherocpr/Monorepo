/**
 * /dashboard/class-requests — Customer's class request history.
 * Server-rendered. Shows all class requests submitted by the customer with their status.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { ClassRequest } from "@/types/class-requests";
import { CLASS_REQUEST_STATUS_LABELS, PREFERRED_TIME_LABELS } from "@/types/class-requests";

export const metadata = {
  title: "My Class Requests | SuperHeroCPR",
};

/** Badge colour mapping per status. */
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-700",
  instructor_assigned: "bg-green-100 text-green-800",
};

/** Renders a human-readable date from an ISO date string. */
function formatDate(isoDate: string): string {
  return new Date(isoDate + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Customer class request history page. */
export default async function ClassRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard/class-requests");

  const admin = await createAdminClient();
  const { data: rawRequests } = await admin
    .from("class_requests")
    .select(`
      id, preferred_date, preferred_time_of_day, group_size,
      venue_name, venue_city, venue_state,
      status, rejection_reason, session_id, created_at,
      class_types ( id, name )
    `)
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });

  const requests = (rawRequests ?? []) as unknown as ClassRequest[];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">My Class Requests</h1>
            <p className="text-gray-600 text-sm">Track the status of your custom class requests.</p>
          </div>
          <Link
            href="/dashboard/request-class"
            className="bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            + New Request
          </Link>
        </div>

        {requests.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">No requests yet</h2>
            <p className="text-sm text-gray-500 mb-6">
              Request a class at your location and we&rsquo;ll send an instructor to you.
            </p>
            <Link
              href="/dashboard/request-class"
              className="inline-block bg-red-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-red-700 transition-colors"
            >
              Request a Class
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => {
              const statusLabel = CLASS_REQUEST_STATUS_LABELS[req.status] ?? req.status;
              const statusStyle = STATUS_STYLES[req.status] ?? "bg-gray-100 text-gray-700";
              const timeLabel = PREFERRED_TIME_LABELS[req.preferred_time_of_day] ?? req.preferred_time_of_day;

              return (
                <div
                  key={req.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {req.class_types?.name ?? "Class Request"}
                      </h3>
                      <p className="text-sm text-gray-500 mt-0.5">
                        Submitted {new Date(req.created_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </p>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-gray-500 shrink-0">Preferred date:</dt>
                      <dd className="text-gray-900">{formatDate(req.preferred_date)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-gray-500 shrink-0">Time:</dt>
                      <dd className="text-gray-900">{timeLabel}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-gray-500 shrink-0">Venue:</dt>
                      <dd className="text-gray-900">
                        {req.venue_name}, {req.venue_city}, {req.venue_state}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-gray-500 shrink-0">Group size:</dt>
                      <dd className="text-gray-900">~{req.group_size} people</dd>
                    </div>
                  </dl>

                  {/* Rejection reason */}
                  {req.status === "rejected" && req.rejection_reason && (
                    <div className="mt-4 bg-red-50 border border-red-100 rounded-lg p-3">
                      <p className="text-xs font-medium text-red-700 mb-0.5">Reason for rejection:</p>
                      <p className="text-sm text-red-800">{req.rejection_reason}</p>
                      <p className="text-xs text-red-600 mt-2">
                        You can{" "}
                        <Link href="/book" className="underline">book a scheduled class</Link>
                        {" "}or{" "}
                        <Link href="/contact" className="underline">contact us</Link>
                        {" "}to discuss other options.
                      </p>
                    </div>
                  )}

                  {/* Link to session when approved */}
                  {(req.status === "approved" || req.status === "instructor_assigned") &&
                    req.session_id && (
                      <div className="mt-4">
                        <Link
                          href="/book"
                          className="text-sm text-red-600 font-medium hover:text-red-700 hover:underline"
                        >
                          View on schedule →
                        </Link>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

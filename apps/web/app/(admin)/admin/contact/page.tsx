/**
 * Admin Contact Submissions page — `/admin/contact`
 * Access: manager and super_admin only.
 * Loads all contact form submissions from the database (with optional filters),
 * checks whether Zoho Mail is connected, then hands off to SubmissionsClient
 * for accordion expansion, thread loading, and reply sending.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import SubmissionsClient, {
  type SubmissionWithReplies,
  type ContactFilters,
} from "@/app/(admin)/_components/SubmissionsClient";

/** Valid inquiry_type values accepted as filter inputs. */
const VALID_TYPES = new Set([
  "General Question",
  "Group Booking",
  "Corporate Training",
  "Certification Renewal",
  "Other",
]);

/** Server component — handles auth, Zoho connection check, and filtered data fetch. */
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    replied?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    (profile.role !== "manager" && profile.role !== "super_admin")
  ) {
    redirect("/admin");
  }

  // ── Zoho connection check ──────────────────────────────────────────────────
  // Use admin client to bypass any RLS on system_settings
  const adminSupabase = await createAdminClient();
  const { data: zohoSetting } = await adminSupabase
    .from("system_settings")
    .select("value")
    .eq("key", "zoho_access_token")
    .maybeSingle();

  const isZohoConnected = !!zohoSetting?.value;

  // ── Build filtered submissions query ──────────────────────────────────────
  // Order: unreplied first, then newest within each group
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("contact_submissions")
    .select(
      `
      id, name, email, phone, inquiry_type, message, replied, created_at,
      contact_replies ( id, created_at )
    `
    )
    .order("replied", { ascending: true })
    .order("created_at", { ascending: false });

  // Apply validated filters — never trust raw input directly into queries
  if (params.type && VALID_TYPES.has(params.type)) {
    query = query.eq("inquiry_type", params.type);
  }
  if (params.replied === "true") query = query.eq("replied", true);
  if (params.replied === "false") query = query.eq("replied", false);
  // Date range — only accept YYYY-MM-DD format to prevent injection
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (params.from && DATE_RE.test(params.from)) {
    query = query.gte("created_at", params.from);
  }
  if (params.to && DATE_RE.test(params.to)) {
    query = query.lte("created_at", `${params.to}T23:59:59`);
  }

  const { data: submissions } = await query;

  // Count unreplied for the header badge
  const unansweredCount = (submissions ?? []).filter(
    (s: { replied: boolean }) => !s.replied
  ).length;

  const activeFilters: ContactFilters = {
    type: params.type,
    replied: params.replied,
    from: params.from,
    to: params.to,
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Contact Submissions</h1>
        {unansweredCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-700">
            {unansweredCount} unanswered
          </span>
        )}
      </div>

      <SubmissionsClient
        initialSubmissions={(submissions ?? []) as SubmissionWithReplies[]}
        filters={activeFilters}
        isZohoConnected={isZohoConnected}
        userRole={profile.role}
      />
    </main>
  );
}

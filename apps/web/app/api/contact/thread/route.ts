/**
 * GET /api/contact/thread
 * Called by: SubmissionsClient — when a submission row is expanded
 * Auth: manager and super_admin only
 * Fetches all email messages exchanged with a given contact email address
 * from the Zoho Mail API. Returns messages formatted for thread display.
 *
 * Query param: email — the contact's email address to search for
 */

import { createClient } from "@/lib/supabase/server";
import { getZohoToken, getSetting } from "@/lib/zoho";

/** A single message in the email thread as returned to the client. */
interface ThreadMessage {
  id: string;
  subject: string;
  body: string;
  from: string;
  date: string;
  /** true = message came from the customer (inbound); false = sent by staff. */
  isInbound: boolean;
}

/**
 * Fetches the Zoho email thread for a given contact email.
 * @param request - GET request with ?email= query param.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (!email || typeof email !== "string") {
    return Response.json(
      { success: false, error: "email query param is required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role !== "manager" && actor.role !== "super_admin")) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Fetch Zoho thread ──────────────────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await getZohoToken();
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Zoho not connected.",
      },
      { status: 503 }
    );
  }

  const accountId = await getSetting("zoho_account_id");
  if (!accountId) {
    return Response.json(
      { success: false, error: "Zoho account ID not configured." },
      { status: 503 }
    );
  }

  // Search Zoho for messages either sent by the contact or sent to them.
  // Zoho expects a GET request with a searchKey expression, not a JSON body.
  const searchKey = `sender:${email}::or:to:${email}`;
  const searchUrl = `https://mail.zoho.com/api/accounts/${accountId}/messages/search?${new URLSearchParams({
    searchKey,
    start: "1",
    limit: "50",
  }).toString()}`;

  const zohoRes = await fetch(searchUrl, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (!zohoRes.ok) {
    const errorBody = await zohoRes.text().catch(() => "(unreadable)");
    console.error("Zoho thread search failed:", zohoRes.status, errorBody);
    return Response.json(
      { success: false, error: "Failed to fetch thread from Zoho Mail." },
      { status: 502 }
    );
  }

  const zohoData = (await zohoRes.json()) as {
    data?: {
      messageId: string;
      subject: string;
      summary: string;
      fromAddress: string;
      sentDateInGMT: string;
    }[];
    status?: { code: number };
  };

  const messages: ThreadMessage[] = (zohoData.data ?? []).map((msg) => ({
    id: msg.messageId,
    subject: msg.subject ?? "(no subject)",
    // Zoho search returns summaries; full body requires a separate call per message.
    // Displaying the summary here for performance — a future enhancement could
    // lazy-load full bodies when a message is expanded.
    body: msg.summary ?? "",
    from: msg.fromAddress ?? "Unknown",
    date: msg.sentDateInGMT ?? new Date().toISOString(),
    // A message is inbound if it came from the contact (not from our own address)
    isInbound: !msg.fromAddress?.includes("superherocpr.com"),
  }));

  return Response.json({ success: true, messages });
}

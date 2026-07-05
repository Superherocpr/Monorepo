/**
 * GET /api/places/autocomplete?q=
 * Called by: AddLocationPanel (address search-as-you-type)
 * Auth: instructor, manager, and super_admin
 * Proxies the Google Places Autocomplete API server-side so the API key is
 * never exposed to the browser. Restricts results to US street addresses only.
 */

import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/**
 * A single autocomplete suggestion returned to the client.
 * Only the fields needed to drive the dropdown and the subsequent details call.
 */
export interface PlaceSuggestion {
  place_id: string;
  description: string;
}

/**
 * Shared auth guard. Returns void on success, or a NextResponse 401/403 on failure.
 * Allows instructor, manager, and super_admin (honors view-as).
 */
async function requireStaffAuth(): Promise<NextResponse | null> {
  const authResult = await requireApiRole(["instructor", "manager", "super_admin"]);
  return "error" in authResult ? authResult.error : null;
}

/**
 * Returns up to 5 US address suggestions matching the query string.
 * Proxies Google Places Autocomplete to keep the API key server-side.
 * @param request - Expects ?q= search query.
 */
export async function GET(request: Request) {
  const authError = await requireStaffAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 3) {
    return NextResponse.json({ success: true, suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Address search is not configured." },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    input: q,
    types: "address",
    components: "country:us",
    key: apiKey,
  });

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
      { next: { revalidate: 0 } }
    );

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: "Address lookup failed. Please enter the address manually." },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      status: string;
      predictions?: Array<{ place_id: string; description: string }>;
    };

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      // Log the actual status so we can diagnose API key / quota issues without exposing it to the client.
      console.error("[places/autocomplete] Google API status:", data.status);
      return NextResponse.json(
        { success: false, error: "Address lookup unavailable. Please enter the address manually." },
        { status: 502 }
      );
    }

    const suggestions: PlaceSuggestion[] = (data.predictions ?? [])
      .slice(0, 5)
      .map(({ place_id, description }) => ({ place_id, description }));

    return NextResponse.json({ success: true, suggestions });
  } catch {
    return NextResponse.json(
      { success: false, error: "Network error. Please enter the address manually." },
      { status: 502 }
    );
  }
}

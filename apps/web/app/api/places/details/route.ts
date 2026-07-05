/**
 * GET /api/places/details?place_id=
 * Called by: AddLocationPanel (after a suggestion is selected)
 * Auth: instructor, manager, and super_admin
 * Proxies the Google Places Details API server-side so the API key is never
 * exposed to the browser. Returns only the parsed address fields needed to
 * populate the location form (address, city, state, zip).
 */

import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/** Parsed address fields returned to the client after a place is selected. */
export interface ParsedAddress {
  /** Street number + route, e.g. "123 Main St" */
  address: string;
  /** City / locality, e.g. "Springfield" */
  city: string;
  /** 2-letter state abbreviation, e.g. "IL" */
  state: string;
  /** 5-digit zip code, e.g. "62701" */
  zip: string;
}

/**
 * Shared auth guard. Returns a NextResponse error or null on success.
 * Allows instructor, manager, and super_admin (honors view-as).
 */
async function requireStaffAuth(): Promise<NextResponse | null> {
  const authResult = await requireApiRole(["instructor", "manager", "super_admin"]);
  return "error" in authResult ? authResult.error : null;
}

/** A single component from the Google Place Details address_components array. */
interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

/**
 * Finds the first address component matching any of the given types.
 * @param components - Full address_components array from the Places API.
 * @param types - One or more type strings to match (e.g. "locality").
 * @param useShortName - When true, returns the short_name (e.g. "CA" vs "California").
 */
function getComponent(
  components: AddressComponent[],
  types: string[],
  useShortName = false
): string {
  const match = components.find((c) => types.some((t) => c.types.includes(t)));
  if (!match) return "";
  return useShortName ? match.short_name : match.long_name;
}

/**
 * Fetches address details for a Google Place ID and returns parsed address fields.
 * Only requests the fields needed (address_components) to minimise billing.
 * @param request - Expects ?place_id= query parameter.
 */
export async function GET(request: Request) {
  const authError = await requireStaffAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("place_id")?.trim() ?? "";

  if (!placeId) {
    return NextResponse.json(
      { success: false, error: "Missing place_id." },
      { status: 400 }
    );
  }

  // Whitelist: place IDs are alphanumeric with underscores/hyphens.
  // Reject anything that looks like an injection attempt.
  if (!/^[A-Za-z0-9_-]+$/.test(placeId)) {
    return NextResponse.json(
      { success: false, error: "Invalid place_id." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Address search is not configured." },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    place_id: placeId,
    // Request only address_components to stay on the cheapest billing tier.
    fields: "address_components",
    key: apiKey,
  });

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
      { next: { revalidate: 0 } }
    );

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: "Could not retrieve address details." },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      status: string;
      result?: { address_components: AddressComponent[] };
    };

    if (data.status !== "OK" || !data.result) {
      return NextResponse.json(
        { success: false, error: "Address details not available." },
        { status: 502 }
      );
    }

    const components = data.result.address_components;

    const streetNumber = getComponent(components, ["street_number"]);
    const route = getComponent(components, ["route"]);
    const address = [streetNumber, route].filter(Boolean).join(" ");
    const city = getComponent(components, ["locality", "sublocality_level_1"]);
    // Use short_name for state to get the 2-letter abbreviation (e.g. "IL" not "Illinois").
    const state = getComponent(components, ["administrative_area_level_1"], true);
    const zip = getComponent(components, ["postal_code"]);

    const parsed: ParsedAddress = { address, city, state, zip };

    return NextResponse.json({ success: true, parsed });
  } catch {
    return NextResponse.json(
      { success: false, error: "Network error. Please enter the address manually." },
      { status: 502 }
    );
  }
}

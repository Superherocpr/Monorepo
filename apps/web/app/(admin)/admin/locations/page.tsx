/**
 * Admin Locations: redirects to /admin/settings where the Locations tab now lives.
 * Kept as a redirect so bookmarked URLs continue to work.
 */

import { redirect } from "next/navigation";

export default function LocationsPage() {
  redirect("/admin/settings");
}

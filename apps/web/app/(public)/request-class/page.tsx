/**
 * /request-class — Public class request page.
 * Accessible to anyone; auth is handled inline by the wizard after the form is
 * filled out. Unauthenticated visitors create an account or sign in at submit
 * time; already-authenticated users submit directly.
 *
 * Accepts an optional ?class= slug, set by the "Request this class" links on
 * /find-a-class, so a visitor who was already told which course they need does
 * not have to pick it again from the dropdown.
 *
 * Also offers our own home-base locations (locations.is_home_base = true) as
 * a no-travel-fee venue option. Only id/city/state are fetched for that list —
 * never the full address — so a location's street address never reaches the
 * page HTML even though the server itself has service-role access to it.
 */

import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { toSlug } from "@/lib/class-slug";
import RequestClassWizard from "./_components/RequestClassWizard";
import type {
  ClassTypeOption,
  HomeBaseLocationOption,
} from "./_components/RequestClassWizard";

export const metadata: Metadata = {
  // The root layout appends "| SuperHeroCPR" via its title template.
  title: "Request a Class",
};

interface RequestClassPageProps {
  /** Next.js 15+: searchParams is a Promise */
  searchParams: Promise<{ class?: string }>;
}

/**
 * Fetches active class types for the form dropdown and renders the wizard.
 * No auth check — the wizard handles authentication at submit time.
 */
export default async function RequestClassPage({
  searchParams,
}: RequestClassPageProps): Promise<React.ReactElement> {
  const params = await searchParams;
  const admin = await createAdminClient();

  const [{ data: rawClassTypes }, { data: rawHomeBases }] = await Promise.all([
    admin
      .from("class_types")
      .select("id, name, duration_minutes")
      .eq("active", true)
      .order("name"),
    admin
      .from("locations")
      .select("id, city, state")
      .eq("is_home_base", true)
      .order("city"),
  ]);

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []) as ClassTypeOption[];
  const homeBaseLocations: HomeBaseLocationOption[] =
    (rawHomeBases ?? []) as HomeBaseLocationOption[];

  const preSelectedClassTypeId =
    (params.class &&
      classTypes.find((ct) => toSlug(ct.name) === params.class)?.id) ||
    null;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 py-12 px-4">
      <RequestClassWizard
        classTypes={classTypes}
        preSelectedClassTypeId={preSelectedClassTypeId}
        homeBaseLocations={homeBaseLocations}
      />
    </div>
  );
}

/**
 * /request-class — Public class request page.
 * Accessible to anyone; auth is handled inline by the wizard after the form is
 * filled out. Unauthenticated visitors create an account or sign in at submit
 * time; already-authenticated users submit directly.
 */

import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import RequestClassWizard from "./_components/RequestClassWizard";
import type { ClassTypeOption } from "./_components/RequestClassWizard";

export const metadata: Metadata = {
  title: "Request a Class | SuperHeroCPR",
};

/**
 * Fetches active class types for the form dropdown and renders the wizard.
 * No auth check — the wizard handles authentication at submit time.
 */
export default async function RequestClassPage(): Promise<React.ReactElement> {
  const admin = await createAdminClient();
  const { data: rawClassTypes } = await admin
    .from("class_types")
    .select("id, name, duration_minutes")
    .eq("active", true)
    .order("name");

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []) as ClassTypeOption[];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 py-12 px-4">
      <RequestClassWizard classTypes={classTypes} />
    </div>
  );
}

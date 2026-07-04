/**
 * /dashboard/request-class — Customer class request form.
 * Lets an authenticated customer request a SuperHeroCPR class at their location.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import RequestClassForm from "./_components/RequestClassForm";
import type { ClassTypeOption } from "./_components/RequestClassForm";

export const metadata = {
  title: "Request a Class | SuperHeroCPR",
};

/** Fetches active class types and renders the customer class request form. */
export default async function RequestClassPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard/request-class");

  const admin = await createAdminClient();
  const { data: rawClassTypes } = await admin
    .from("class_types")
    .select("id, name, duration_minutes")
    .eq("active", true)
    .order("name");

  const classTypes: ClassTypeOption[] = (rawClassTypes ?? []) as ClassTypeOption[];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Request a Class</h1>
          <p className="text-gray-600">
            Can&rsquo;t make it to one of our scheduled classes? We&rsquo;ll come to you.
            Fill out the form below to request a CPR class at your location.
            Our team reviews all requests and will follow up within 1–2 business days.
          </p>
        </div>

        <RequestClassForm classTypes={classTypes} />
      </div>
    </div>
  );
}

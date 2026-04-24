/**
 * Layout for all /dashboard/* routes.
 * Handles auth guard: redirects unauthenticated users to sign-in,
 * and signs out + redirects archived accounts.
 * Wraps all dashboard pages with DashboardNav.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardNav from "./_components/DashboardNav";

/** Protects all /dashboard/* routes and injects the shared nav layout. */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin?redirect=/dashboard");
  }

  // Archived accounts must not access the portal even with a valid session
  const { data: profile } = await supabase
    .from("profiles")
    .select("archived")
    .eq("id", user.id)
    .single();

  if (profile?.archived) {
    await supabase.auth.signOut();
    redirect("/?accountDeleted=true");
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-full bg-gray-50">
      <DashboardNav />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/**
 * /dashboard/certifications — Customer's full certifications list.
 * Fully server-rendered. Splits certs into active and expired groups.
 * Shows the renewal CTA banner when any active cert expires within 60 days.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CertificationsPageHeader from "./_components/CertificationsPageHeader";
import RenewalCtaBanner from "./_components/RenewalCtaBanner";
import ActiveCertificationsList from "./_components/ActiveCertificationsList";
import ExpiredCertificationsList from "./_components/ExpiredCertificationsList";
import type { CertificationRecord } from "@/types/certifications";

export const metadata = {
  title: "My Certifications | Superhero CPR",
};

/** Renders the certifications page with active and expired groups, plus renewal banner. */
export default async function CertificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard/certifications");

  const { data: certs } = await supabase
    .from("certifications")
    .select(
      `id, cert_number, issued_at, expires_at,
       cert_types ( name ),
       class_sessions ( id )`
    )
    .eq("customer_id", user.id)
    .order("expires_at", { ascending: false });

  const now = new Date();
  const sixtyDaysFromNow = new Date(
    now.getTime() + 60 * 24 * 60 * 60 * 1000
  );

  const all = (certs ?? []) as CertificationRecord[];

  const active = all.filter((c) => new Date(c.expires_at) >= now);
  const expired = all.filter((c) => new Date(c.expires_at) < now);

  // An expiring-soon cert is active but expires within the next 60 days
  const hasExpiringSoon = active.some(
    (c) => new Date(c.expires_at) <= sixtyDaysFromNow
  );

  return (
    <div>
      <CertificationsPageHeader />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {hasExpiringSoon && <RenewalCtaBanner />}
        <ActiveCertificationsList certifications={active} />
        <ExpiredCertificationsList certifications={expired} />
      </div>
    </div>
  );
}

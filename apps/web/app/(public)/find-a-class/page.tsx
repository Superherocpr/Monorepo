/**
 * /find-a-class — guided walkthrough that tells a visitor which course they need.
 *
 * Server component: loads the active catalog once, merges in how many bookable
 * dates each class currently has, and hands the whole set to the client wizard.
 * The availability count is used only to route the result screen to /book or
 * /request-class — it is deliberately never shown as a number or a date. A
 * visitor who sees "no dates" partway through has no use for that information
 * yet and every reason to leave before reaching the recommendation.
 */

import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { toSlug } from "@/lib/class-slug";
import { getClassAvailability } from "@/lib/class-availability";
import FindAClassWizard, {
  type FinderClassOption,
} from "./_components/FindAClassWizard";

export const metadata: Metadata = {
  // The root layout appends "| SuperHeroCPR" via its title template.
  title: "Which CPR Class Do I Need?",
  description:
    "Answer a few questions and we will tell you which AHA course you need, whether it is BLS for healthcare work, Heartsaver for your workplace, or CPR for your own family.",
};

/** Row shape returned by the class type query. */
interface ClassTypeRow {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | string;
  is_aha: boolean;
}

/**
 * Loads the active catalog with live availability and renders the walkthrough.
 *
 * Uses the service-role client for the same reason /book does: counting seats
 * requires reading every booking and invoice on a session, which the anon client
 * cannot see, so an anon read would report every class wide open.
 */
export default async function FindAClassPage(): Promise<React.ReactElement> {
  const supabase = await createAdminClient();

  const [{ data: rawClassTypes }, availability] = await Promise.all([
    supabase
      .from("class_types")
      .select("id, name, description, duration_minutes, price, is_aha")
      .eq("active", true)
      .order("name"),
    getClassAvailability(supabase),
  ]);

  const classes: FinderClassOption[] = ((rawClassTypes ?? []) as ClassTypeRow[]).map(
    (ct) => {
      const seats = availability.get(ct.id);
      return {
        id: ct.id,
        name: ct.name,
        slug: toSlug(ct.name),
        description: ct.description,
        durationMinutes: ct.duration_minutes,
        price: Number(ct.price),
        isAha: ct.is_aha,
        upcomingCount: seats?.upcomingCount ?? 0,
      };
    }
  );

  return <FindAClassWizard classes={classes} />;
}

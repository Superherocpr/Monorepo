/**
 * ClassTypeCards — full-width card list of CPR course offerings on the /classes page.
 * Fetches active class types from the DB. Each card has a URL-safe anchor ID
 * so the home page can link directly to a specific class (e.g. /classes#bls).
 * Used by: app/(public)/classes/page.tsx
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ClassType } from "@/types/schedule";

/**
 * Formats a duration in minutes to a human-readable string.
 * e.g. 120 → "2 hours", 90 → "1 hr 30 min"
 * @param minutes - Duration in minutes.
 */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  return `${hours} hr ${mins} min`;
}

/** Converts a class type name to a URL-safe slug for anchor links. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Renders a vertical stack of class type cards fetched from the database.
 * Falls back to an empty-state card if no class types exist.
 */
export default async function ClassTypeCards() {
  const supabase = await createClient();

  const { data: classTypes } = await supabase
    .from("class_types")
    .select("id, name, description, duration_minutes, max_capacity, price")
    .eq("active", true)
    .order("name");

  if (!classTypes || classTypes.length === 0) {
    return (
      <section className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="border-l-4 border-gray-200 pl-6 py-4">
            <p className="text-gray-500">
              Class types are being added. Check back soon.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">
        {(classTypes as ClassType[]).map((classType) => {
          const slug = toSlug(classType.name);
          const headingId = `${slug}-heading`;

          return (
            <section
              key={classType.id}
              id={slug}
              aria-labelledby={headingId}
              className="border-l-4 border-red-600 pl-6 py-2"
            >
              <h2
                id={headingId}
                className="text-2xl font-bold tracking-tight text-gray-900 mb-3"
              >
                {classType.name}
              </h2>

              {classType.description && (
                <p className="text-gray-600 leading-relaxed mb-5">
                  {classType.description}
                </p>
              )}

              {/* Detail badges */}
              <div className="flex flex-wrap gap-3 mb-6">
                <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-full">
                  {formatDuration(classType.duration_minutes)}
                </span>
                <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-full">
                  Up to {classType.max_capacity} students
                </span>
                <span className="bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-full">
                  {classType.price.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}{" "}
                  per person
                </span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  href={`/book?class=${slug}`}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150 text-sm"
                >
                  Book This Class
                </Link>
                <Link
                  href={`/schedule?class=${slug}`}
                  className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors duration-150"
                >
                  View Schedule →
                </Link>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

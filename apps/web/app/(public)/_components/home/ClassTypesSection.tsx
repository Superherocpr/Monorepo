/**
 * ClassTypesSection — active class type card grid on the home page.
 * Server component — fetches active class types from the DB.
 * Used by: app/(public)/page.tsx
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ClassType } from "@/types/schedule";

/** Converts a class type name to a URL-safe anchor slug. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Formats duration in minutes to a human-readable string. */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  return `${hours} hr ${mins} min`;
}

/**
 * Renders class type cards from the database.
 * Shows 4 skeleton placeholder cards if no class types exist yet.
 */
export default async function ClassTypesSection() {
  const supabase = await createClient();

  // Only show active class types — deactivated types are not visible publicly
  const { data: classTypes } = await supabase
    .from("class_types")
    .select("id, name, description, duration_minutes, price, active, max_capacity, created_at")
    .eq("active", true)
    .order("name");

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 mb-3">
            Find the Right Class for You
          </h2>
          <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
            We offer American Heart Association certification courses for every
            need — from healthcare professionals to everyday heroes.
          </p>
        </div>

        {!classTypes || classTypes.length === 0 ? (
          // Empty state — show 4 skeleton cards so layout doesn't collapse
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="border border-gray-200 rounded-xl p-6 flex flex-col gap-3 animate-pulse"
                aria-hidden="true"
              >
                <div className="h-5 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mt-2" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(classTypes as ClassType[]).map((ct) => {
              const slug = toSlug(ct.name);
              return (
                <div
                  key={ct.id}
                  className="border border-gray-200 rounded-xl p-6 flex flex-col gap-3 hover:border-red-200 transition-colors duration-150"
                >
                  <h3 className="text-base font-bold text-gray-900">{ct.name}</h3>

                  {ct.description && (
                    <p className="text-sm text-gray-600 leading-relaxed flex-1">
                      {ct.description}
                    </p>
                  )}

                  <div className="flex flex-col gap-1 text-sm text-gray-500 mt-auto">
                    <span>{formatDuration(ct.duration_minutes)}</span>
                    <span>
                      Starting at{" "}
                      {ct.price.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 0,
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-2">
                    <Link
                      href={`/classes#${slug}`}
                      className="text-sm text-red-600 font-medium hover:text-red-700 transition-colors duration-150"
                    >
                      Learn More
                    </Link>
                    <Link
                      href="/book"
                      className="ml-auto text-sm bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors duration-150"
                    >
                      Book Now
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

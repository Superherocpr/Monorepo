/**
 * AboutInstructorSection — lead instructor spotlight on the home page.
 * Server component — fetches the lead instructor's name from the DB.
 * Used by: app/(public)/page.tsx
 */

import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";

/** Renders the "Meet Your Instructor" two-column section. */
export default async function AboutInstructorSection() {
  const supabase = await createClient();

  // Use is_lead_instructor = true — NOT role = 'super_admin'.
  // There is exactly one profile with is_lead_instructor = true.
  const { data: instructor } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("is_lead_instructor", true)
    .single();

  const instructorName = instructor
    ? `${instructor.first_name} ${instructor.last_name}`
    : "Our Lead Instructor";

  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* Photo */}
          <div className="flex justify-center lg:justify-start">
            {/*
             * TODO: replace with real instructor photo.
             * Save to /public/images/lead-instructor.jpg and update src below.
             */}
            <div className="relative w-64 h-64 lg:w-80 lg:h-80 rounded-2xl overflow-hidden bg-gray-200">
              <Image
                src="/images/lead-instructor.jpg"
                alt={`${instructorName}, lead CPR instructor`}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 256px, 320px"
              />
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col gap-5">
            <p className="text-red-600 text-sm font-semibold uppercase tracking-widest">
              Meet Your Instructor
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">
              {instructorName}
            </h2>
            <p className="text-gray-600 leading-relaxed">
              With thousands of documented real-world CPR patients and active
              experience on the front lines of Fire, EMS, and Emergency Room
              response, our lead instructor brings unmatched real-world
              knowledge to every class. This isn't just certification — it's
              training that could save someone's life.
            </p>

            {/* TODO: add AHA logo asset to /public/images/aha-logo.png */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-xs text-gray-400 text-center leading-tight">
                AHA
              </div>
              <span className="text-sm text-gray-500">
                Licensed American Heart Association Instructor
              </span>
            </div>

            <Link
              href="/about"
              className="self-start text-sm font-medium text-red-600 hover:text-red-700 transition-colors duration-150"
            >
              Learn more about our team →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

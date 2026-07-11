"use client";

/**
 * PrivateSessionCta — "Can't Find a Time?" CTA below the session list.
 * Checks auth state on mount: authenticated customers are linked directly to
 * the request form; unauthenticated visitors are sent to sign-in first with a
 * redirect back to the request form after login.
 * Used by: app/(public)/book/_components/BookSessionSelector.tsx
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const REQUEST_PATH = "/dashboard/request-class";

/** Renders the private group session call-to-action with a "Request a Class" button. */
export default function PrivateSessionCta() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Resolve auth state once on mount; default to unauthenticated until resolved.
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setIsAuthenticated(!!user);
      });
  }, []);

  const requestHref = isAuthenticated
    ? REQUEST_PATH
    : `/signin?redirect=${REQUEST_PATH}`;

  return (
    <section className="py-16 px-4 bg-gray-50 text-center">
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Can&apos;t Find a Time That Works?
        </h2>
        <p className="text-gray-600 leading-relaxed">
          We offer private group sessions at your home, office, or facility.
          Request a class at your location and we&apos;ll work with you to make it happen.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-3 mt-1">
          <Link
            href={requestHref}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150"
          >
            Request a Class
          </Link>
          <Link
            href="/contact"
            className="text-gray-600 hover:text-red-600 font-medium transition-colors duration-150 text-sm"
          >
            Contact Us Instead
          </Link>
        </div>
      </div>
    </section>
  );
}

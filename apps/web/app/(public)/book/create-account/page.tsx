"use client";

/**
 * /book/create-account — Retired. Account creation now happens inline on the
 * payment page. This redirect ensures any bookmarked or cached URL still lands
 * somewhere sensible.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBookingStore } from "@/lib/booking-store";

/** Redirects away from the retired create-account step. */
export default function BookCreateAccountRedirect() {
  const router = useRouter();

  useEffect(() => {
    const store = getBookingStore();
    if (!store.sessionId) {
      router.replace("/book");
    } else if (store.customerDetails) {
      router.replace("/book/payment");
    } else {
      router.replace("/book/details");
    }
  }, [router]);

  return null;
}

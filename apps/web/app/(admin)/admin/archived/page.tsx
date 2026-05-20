/**
 * /admin/archived — Archived Customer Accounts page.
 * Server component: fetches all archived customers with booking/cert/order counts.
 * Access: super_admin only.
 * Used by: AdminSidebar "Archived Accounts" link.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import ArchivedClient from "./_components/ArchivedClient";

export const metadata: Metadata = {
  title: "Archived Accounts | SuperHeroCPR Admin",
};

/** Shape of an archived customer passed to the client component. */
export interface ArchivedCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  archived_at: string | null;
  created_at: string;
  bookingCount: number;
  certCount: number;
  orderCount: number;
}

/**
 * Fetches all archived customer profiles and passes them to the client component.
 * Redirects non-super-admins to /admin.
 */
export default async function ArchivedPage() {
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?redirect=/admin/archived");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    redirect("/admin");
  }

  // ── Fetch archived customers with related counts ───────────────────────────
  // bookings uses the customer_id FK hint to avoid PostgREST ambiguity
  // (bookings.customer_id, bookings.created_by, bookings.cancelled_by all point to profiles)
  const { data: rows } = await supabase
    .from("profiles")
    .select(
      `
      id, first_name, last_name, email, phone, archived_at, created_at,
      bookings!customer_id ( id ),
      certifications!customer_id ( id ),
      orders ( id )
    `
    )
    .eq("role", "customer")
    .eq("archived", true)
    .order("archived_at", { ascending: false });

  const customers: ArchivedCustomer[] = (rows ?? []).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    archived_at: c.archived_at,
    created_at: c.created_at,
    bookingCount: Array.isArray(c.bookings) ? c.bookings.length : 0,
    certCount: Array.isArray(c.certifications) ? c.certifications.length : 0,
    orderCount: Array.isArray(c.orders) ? c.orders.length : 0,
  }));

  return <ArchivedClient customers={customers} />;
}

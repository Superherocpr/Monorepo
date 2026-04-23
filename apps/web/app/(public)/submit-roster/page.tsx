/**
 * /submit-roster — Public page for group class contacts to submit their staff roster.
 * No auth required. Contacts receive this link in their group invoice email.
 * Used by: HR managers, office managers, and company contacts organising group CPR training.
 */

import SubmitRosterClient from "./_components/SubmitRosterClient";

/** Next.js 15+: searchParams is a Promise in App Router. */
interface PageProps {
  searchParams: Promise<{ invoice?: string }>;
}

/**
 * Reads the optional invoice query param and renders the multi-step roster upload flow.
 * If ?invoice= is present, the client auto-fills the invoice number and advances past Step 1.
 * @param searchParams - URL query params, optionally containing an invoice number.
 */
export default async function SubmitRosterPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const prefilledInvoice = params.invoice ?? null;

  return <SubmitRosterClient prefilledInvoice={prefilledInvoice} />;
}

"use client";

/**
 * TeamSignupClient — the interactive half of the public team signup page.
 * Used by: app/(public)/team/[share_token]/page.tsx
 *
 * Holds three things on one screen, because the company contact and their
 * employees share a single URL:
 *   1. the class details,
 *   2. the running list of who has signed up (names only) and the headcount,
 *   3. the signup flow itself.
 *
 * Signup steps are held in component state rather than separate routes so the
 * employee never loses their place: details → auth (if signed out) → payment
 * (per-seat only) → done. Company-paid signups skip payment entirely.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { PayPalProvider, PayPalOneTimePaymentButton } from "@paypal/react-paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/react-paypal-js/sdk-v6";
import { createClient } from "@/lib/supabase/client";
import { CardPaymentSection } from "@/app/_components/PayPalCardPaymentSection";
import type { CreateOrderResult } from "@/app/_components/PayPalCardPaymentSection";
import type { TeamBookingPublicView } from "@/lib/team-bookings";
import { formatClassDate, formatClassTime } from "@/lib/business-time";

interface Props {
  /** Token from the URL — passed on every API call as the credential. */
  shareToken: string;
  /** Server-rendered snapshot; refreshed client-side as people sign up. */
  initialView: TeamBookingPublicView;
}

/** Which panel of the signup flow is showing. */
type Step = "details" | "auth" | "payment" | "done";

/** Whether the auth panel is creating an account or signing in. */
type AuthMode = "create" | "signin";

// NOTE: must stay `NEXT_PUBLIC_PAYPAL_ENV` — that is the name actually set in
// Amplify (app-level, "production"). This file previously read
// `NEXT_PUBLIC_PAYPAL_ENVIRONMENT`, which is set nowhere, so it silently
// resolved to "sandbox" and handed the SDK a sandbox environment alongside a
// production clientId/clientToken. Verified against Amplify app dzmna7ztg21it
// on 2026-08-20; the other three payment surfaces already use this name.
const PAYPAL_ENVIRONMENT =
  process.env.NEXT_PUBLIC_PAYPAL_ENV === "production" ? "production" : "sandbox";

/**
 * Formats a class start time as the wall clock the instructor set.
 * @param iso - Stored class timestamp.
 * @returns Object with human-readable date and time strings.
 */
function formatWhen(iso: string): { date: string; time: string } {
  return { date: formatClassDate(iso), time: formatClassTime(iso) };
}

/**
 * Renders the full public team signup experience.
 * @param props - Share token and the server-rendered initial view.
 */
export default function TeamSignupClient({ shareToken, initialView }: Props): ReactElement {
  const [view, setView] = useState<TeamBookingPublicView>(initialView);
  const [step, setStep] = useState<Step>("details");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Null while unknown, then the signed-in user's id or false for signed out. */
  const [userId, setUserId] = useState<string | null | false>(null);

  // Auth panel state
  const [authMode, setAuthMode] = useState<AuthMode>("create");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // Per-seat payment state
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; finalPrice: number } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [clientToken, setClientToken] = useState<string | undefined>(undefined);
  const [clientTokenError, setClientTokenError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const amountDue = appliedPromo ? appliedPromo.finalPrice : view.pricePerSeat;
  const isCompanyPaid = view.paymentMode === "company";

  // ── Detect an existing session so returning employees skip the auth step ──
  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? false))
      .catch(() => setUserId(false));
  }, []);

  /** Re-fetches the attendee list and seat count after a signup. */
  const refreshView = useCallback(async () => {
    try {
      const res = await fetch(`/api/team-bookings/${shareToken}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: TeamBookingPublicView };
      if (json.data) setView(json.data);
    } catch {
      // A failed refresh only means a stale list — never block the user on it.
    }
  }, [shareToken]);

  // Card fields need a client token; only fetch once we actually reach payment.
  useEffect(() => {
    if (step !== "payment" || isCompanyPaid || clientToken || clientTokenError) return;
    fetch("/api/paypal/client-token")
      .then(async (res) => {
        if (!res.ok) throw new Error("token fetch failed");
        const data = (await res.json()) as { clientToken?: string };
        if (!data.clientToken) throw new Error("Client token missing from response");
        return data.clientToken;
      })
      .then(setClientToken)
      .catch(() => setClientTokenError(true));
  }, [step, isCompanyPaid, clientToken, clientTokenError]);

  /**
   * Advances from the details panel: straight to payment/confirm when already
   * signed in, otherwise into the auth panel first.
   */
  function handleStartSignup(): void {
    setError(null);
    if (userId) {
      if (isCompanyPaid) void submitSignup();
      else setStep("payment");
      return;
    }
    setStep("auth");
  }

  /**
   * Creates an account or signs in, then continues into the signup.
   * Side effects: Supabase auth call, profile insert on account creation.
   * @param e - Form submit event.
   */
  async function handleAuth(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const supabase = createClient();

    if (authMode === "signin") {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError || !data.user) {
        setError(signInError?.message ?? "Could not sign you in. Please check your details.");
        setBusy(false);
        return;
      }
      setUserId(data.user.id);
      setBusy(false);
      if (isCompanyPaid) void submitSignup();
      else setStep("payment");
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      setBusy(false);
      return;
    }
    if (!phone.trim()) {
      setError("Phone number is required.");
      setBusy(false);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setBusy(false);
      return;
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (authError || !authData.user) {
      setError(authError?.message ?? "Failed to create your account. Please try again.");
      setBusy(false);
      return;
    }

    // The profile row is what puts a real name on the roster and RollCall.
    const { error: profileError } = await supabase.from("profiles").insert({
      id: authData.user.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      role: "customer",
    });

    if (profileError) {
      setError("Your account was created but we couldn't save your details. Please contact us.");
      setBusy(false);
      return;
    }

    await fetch("/api/emails/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: firstName.trim(), email: email.trim() }),
    }).catch(() => {
      // Welcome email failure is non-fatal.
    });

    setUserId(authData.user.id);
    setBusy(false);
    if (isCompanyPaid) void submitSignup();
    else setStep("payment");
  }

  /**
   * Validates a promo code against this class, server-side.
   * Side effects: POST /api/promo-codes/validate.
   */
  async function handleApplyPromo(): Promise<void> {
    setPromoError(null);
    const code = promoInput.trim();
    if (!code) return;

    try {
      const res = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The token, not the session id, so the quote is priced against the
        // negotiated per-seat rate that checkout will actually charge.
        body: JSON.stringify({ code, teamShareToken: shareToken }),
      });
      const json = (await res.json()) as {
        valid?: boolean;
        error?: string;
        code?: string;
        finalPrice?: number;
      };

      if (!res.ok || !json.valid || typeof json.finalPrice !== "number") {
        setPromoError(json.error ?? "That promo code isn't valid for this class.");
        return;
      }
      setAppliedPromo({ code: json.code ?? code, finalPrice: json.finalPrice });
    } catch {
      setPromoError("Couldn't check that code. Please try again.");
    }
  }

  /**
   * Sends the signup to the server. Used for company-paid (no payment) and,
   * after a capture, for per-seat signups.
   * Side effects: POST /api/team-bookings/[token]/signup — creates the booking.
   * @param paypalOrderId - PayPal order id for per-seat signups.
   */
  async function submitSignup(paypalOrderId?: string): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/team-bookings/${shareToken}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCompanyPaid
            ? {}
            : {
                paypalOrderId,
                amount: amountDue,
                promoCode: appliedPromo?.code ?? null,
              }
        ),
      });

      const json = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(json.error ?? "We couldn't complete your signup. Please try again.");
        setBusy(false);
        return;
      }

      setBusy(false);
      setStep("done");
      await refreshView();
    } catch {
      setError("Network error. Please check your connection and try again.");
      setBusy(false);
    }
  }

  /**
   * Creates the PayPal order for a per-seat signup. The price is re-derived
   * server-side from the share token, so this sends no amount.
   */
  async function handleCreateOrder(): Promise<CreateOrderResult> {
    const res = await fetch("/api/paypal/create-booking-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamShareToken: shareToken,
        promoCode: appliedPromo?.code ?? null,
      }),
    });

    const json = (await res.json()) as { orderId?: string; error?: string };
    if (!res.ok || !json.orderId) {
      throw new Error(json.error ?? "Could not start the payment.");
    }
    return { orderId: json.orderId };
  }

  /** Captures the approved PayPal order by completing the signup. */
  async function handleApprove(data: { orderId: string } | OnApproveDataOneTimePayments): Promise<void> {
    const orderId = "orderId" in data ? data.orderId : (data as { orderID?: string }).orderID;
    if (!orderId) {
      setError("Payment approved but no order reference came back. Please contact us.");
      return;
    }
    await submitSignup(orderId);
  }

  const when = formatWhen(view.startsAt);
  const visibleAttendees = searchTerm.trim()
    ? view.attendees.filter((a) =>
        `${a.firstName} ${a.lastName}`.toLowerCase().includes(searchTerm.trim().toLowerCase())
      )
    : view.attendees;

  // ── Shared page chrome ───────────────────────────────────────────────────
  const pageContent = (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      {/* Class header */}
      <header className="bg-white border border-gray-200 rounded-xl p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
          {view.companyName}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{view.className}</h1>
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">When</dt>
            <dd className="text-gray-900 font-medium">
              {when.date}
              <br />
              {when.time} ET
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Where</dt>
            <dd className="text-gray-900 font-medium">
              {view.locationName}
              {view.locationAddress && (
                <>
                  <br />
                  <span className="font-normal text-gray-600">
                    {[view.locationAddress, view.locationCity, view.locationState, view.locationZip]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </>
              )}
            </dd>
          </div>
          {view.instructorName && (
            <div>
              <dt className="text-gray-500">Instructor</dt>
              <dd className="text-gray-900 font-medium">{view.instructorName}</dd>
            </div>
          )}
          <div>
            <dt className="text-gray-500">Cost to you</dt>
            <dd className="text-gray-900 font-medium">
              {isCompanyPaid ? (
                <span className="text-green-700">
                  Nothing — {view.companyName} has paid for this class
                </span>
              ) : (
                `$${view.pricePerSeat.toFixed(2)}`
              )}
            </dd>
          </div>
        </dl>
      </header>

      {/* ── Signed-up list — the company contact's confirmation view ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-base font-semibold text-gray-900">
            Signed up{" "}
            <span className="text-gray-400 font-normal">
              ({view.attendeeCount} of {view.maxCapacity})
            </span>
          </h2>
          {view.attendeeCount > 0 && (
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name…"
              aria-label="Search signed-up people by name"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          )}
        </div>

        {view.attendeeCount === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            Nobody has signed up yet. Be the first — or send this link to your team.
          </p>
        ) : visibleAttendees.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No one matching “{searchTerm}”.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visibleAttendees.map((a, i) => (
              <li
                key={`${a.firstName}-${a.lastName}-${i}`}
                className="text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2"
              >
                {a.firstName} {a.lastName}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-gray-400">
          {view.spotsRemaining > 0
            ? `${view.spotsRemaining} spot${view.spotsRemaining === 1 ? "" : "s"} left.`
            : "This class is full."}
        </p>
      </section>

      {/* ── Signup flow ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-6">
        {error && (
          <div
            role="alert"
            className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        {view.closed && step !== "done" ? (
          <div className="text-sm text-gray-700">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Signups are closed</h2>
            <p>
              {view.closedReason === "full"
                ? "Every spot in this class has been taken."
                : view.closedReason === "cancelled"
                  ? "This class has been cancelled."
                  : view.closedReason === "past"
                    ? "This class has already started."
                    : "This class isn't open for signups just yet — please check back shortly."}
            </p>
            <p className="mt-3">
              Questions? Call{" "}
              <a
                href={`tel:${view.cancellationPhone.replace(/[^0-9+]/g, "")}`}
                className="text-red-600 font-medium hover:underline"
              >
                {view.cancellationPhone}
              </a>
              .
            </p>
          </div>
        ) : step === "done" ? (
          <div className="text-sm text-gray-700">
            <h2 className="text-lg font-bold text-gray-900 mb-2">You&apos;re signed up</h2>
            <p>
              Your spot is reserved and a confirmation email is on its way. Please arrive about 10
              minutes early.
            </p>
            <p className="mt-3">
              Need to cancel? Call{" "}
              <a
                href={`tel:${view.cancellationPhone.replace(/[^0-9+]/g, "")}`}
                className="text-red-600 font-medium hover:underline"
              >
                {view.cancellationPhone}
              </a>{" "}
              — cancellations are handled by phone.
            </p>
          </div>
        ) : step === "details" ? (
          <div>
            <h2 className="text-base font-semibold text-gray-900">Reserve your spot</h2>
            <p className="mt-1 text-sm text-gray-600">
              {isCompanyPaid
                ? "Your employer has already paid. We just need your details so your certification card is issued correctly."
                : "Sign up with your own details so your certification card is issued correctly."}
            </p>
            <button
              type="button"
              onClick={handleStartSignup}
              disabled={busy || userId === null}
              className="mt-4 w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              {busy ? "Working…" : userId ? "Sign me up" : "Get started"}
            </button>
          </div>
        ) : step === "auth" ? (
          <form onSubmit={handleAuth} noValidate className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {authMode === "create" ? "Create your account" : "Sign in"}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "create" ? "signin" : "create");
                  setError(null);
                }}
                className="text-sm text-red-600 hover:underline"
              >
                {authMode === "create" ? "I already have an account" : "I need an account"}
              </button>
            </div>

            {authMode === "create" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="ts-first" className="text-sm font-medium text-gray-700">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ts-first"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name"
                      className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="ts-last" className="text-sm font-medium text-gray-700">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ts-last"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                      className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ts-phone" className="text-sm font-medium text-gray-700">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ts-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-email" className="text-sm font-medium text-gray-700">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="ts-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-password" className="text-sm font-medium text-gray-700">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                id="ts-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={authMode === "create" ? "new-password" : "current-password"}
                className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              {authMode === "create" && (
                <p className="text-xs text-gray-400">At least 8 characters.</p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg text-sm transition-colors"
              >
                {busy ? "Please wait…" : "Continue"}
              </button>
              <button
                type="button"
                onClick={() => setStep("details")}
                className="px-5 text-sm text-gray-500 hover:text-gray-700"
              >
                Back
              </button>
            </div>
          </form>
        ) : (
          /* step === "payment" — per-seat only */
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-gray-900">Payment</h2>

            {/* Promo code */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ts-promo" className="text-sm font-medium text-gray-700">
                Promo code <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="ts-promo"
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value)}
                  disabled={!!appliedPromo}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:bg-gray-50"
                />
                <button
                  type="button"
                  onClick={appliedPromo ? () => {
                    setAppliedPromo(null);
                    setPromoInput("");
                    setPromoError(null);
                  } : handleApplyPromo}
                  className="px-4 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:border-red-400 hover:text-red-600 transition-colors"
                >
                  {appliedPromo ? "Remove" : "Apply"}
                </button>
              </div>
              {promoError && <p className="text-xs text-red-600">{promoError}</p>}
              {appliedPromo && (
                <p className="text-xs text-green-700">
                  {appliedPromo.code} applied — you pay ${appliedPromo.finalPrice.toFixed(2)}.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <span className="text-sm text-gray-600">Total due</span>
              <span className="text-xl font-bold text-gray-900">${amountDue.toFixed(2)}</span>
            </div>

            {amountDue <= 0 ? (
              <button
                type="button"
                onClick={() => void submitSignup()}
                disabled={busy}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg text-sm transition-colors"
              >
                {busy ? "Reserving…" : "Complete signup (free)"}
              </button>
            ) : clientTokenError ? (
              <div className="space-y-4">
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Card payment couldn&apos;t load. You can still pay with PayPal below.
                </p>
                <PayPalOneTimePaymentButton
                  presentationMode="auto"
                  createOrder={handleCreateOrder}
                  onApprove={handleApprove}
                  onError={() => setError("PayPal encountered an error. Please try again.")}
                />
              </div>
            ) : !clientToken ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-10 bg-gray-100 rounded-lg" />
                <div className="h-10 bg-gray-100 rounded-lg" />
                <div className="h-12 bg-gray-100 rounded-lg" />
              </div>
            ) : (
              <div className="space-y-6">
                <CardPaymentSection
                  onCreateOrder={handleCreateOrder}
                  onApprove={handleApprove}
                  onError={(msg) => setError(msg)}
                  amount={amountDue}
                  disabled={busy}
                />
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                    or pay with
                  </span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <PayPalOneTimePaymentButton
                  presentationMode="auto"
                  createOrder={handleCreateOrder}
                  onApprove={handleApprove}
                  onError={() => setError("PayPal encountered an error. Please try again.")}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <p className="text-center text-xs text-gray-400">
        Need help? Call{" "}
        <a
          href={`tel:${view.cancellationPhone.replace(/[^0-9+]/g, "")}`}
          className="text-red-600 hover:underline"
        >
          {view.cancellationPhone}
        </a>
      </p>
    </main>
  );

  // Company-paid signups never touch PayPal, so the SDK is not loaded at all.
  if (isCompanyPaid) return pageContent;

  // Card fields require a clientToken; fall back to a clientId-only provider so
  // the PayPal button still works when that fetch fails.
  if (clientTokenError) {
    return (
      <PayPalProvider
        clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
        environment={PAYPAL_ENVIRONMENT}
        components={["paypal-payments"]}
        pageType="checkout"
      >
        {pageContent}
      </PayPalProvider>
    );
  }

  return (
    <PayPalProvider
      clientToken={clientToken}
      environment={PAYPAL_ENVIRONMENT}
      components={["card-fields", "paypal-payments"]}
      pageType="checkout"
    >
      {pageContent}
    </PayPalProvider>
  );
}

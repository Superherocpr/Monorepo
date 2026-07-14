"use client";

/**
 * /book/payment — Step 4 of the booking wizard: PayPal checkout.
 * Uses PayPal v9 API (PayPalProvider + PayPalOneTimePaymentButton from sdk-v6).
 * Calls /api/paypal/create-booking-order to create the order server-side,
 * then /api/bookings/confirm to capture payment and create the booking record.
 * For 100% promo codes, calls /api/bookings/confirm-free instead (no PayPal).
 * Used by: booking flow after account creation (step 3) or sign-in (step 2a).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PayPalProvider,
  PayPalOneTimePaymentButton,
} from "@paypal/react-paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/react-paypal-js/sdk-v6";
import { getBookingStore, setBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import type { BookingStore, AppliedPromoCode } from "@/lib/booking-store";
import type { PromoValidateResponse } from "@/app/api/promo-codes/validate/route";

/** Renders Step 4 — PayPal payment (or free booking via promo) for the selected session. */
export default function BookPaymentPage() {
  const router = useRouter();
  const [store] = useState<BookingStore | null>(() => {
    const s = getBookingStore();
    return s.sessionId && s.customerId ? s : null;
  });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isFullError, setIsFullError] = useState(false);

  // Promo code state
  const [promoInput, setPromoInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromoCode | null>(
    () => getBookingStore().appliedPromoCode ?? null
  );

  // Dev bypass state — only used in development builds.
  const [devBypassing, setDevBypassing] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  // Guards: redirect if required prior steps are incomplete
  useEffect(() => {
    if (!store) {
      const s = getBookingStore();
      if (!s.sessionId) router.replace("/book");
      else router.replace("/book/details");
    }
  }, [store, router]);

  /** Applies a promo code by calling the validate endpoint and storing the result. */
  async function handleApplyPromo() {
    if (!store?.sessionId || !promoInput.trim()) return;
    setPromoError(null);
    setPromoLoading(true);

    try {
      const res = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput.trim(), sessionId: store.sessionId }),
      });
      const data = (await res.json()) as PromoValidateResponse;

      if (!data.valid) {
        setPromoError(data.error);
        return;
      }

      const promo: AppliedPromoCode = {
        code: data.code,
        discountType: data.discountType,
        discountValue: data.discountValue,
        originalPrice: data.originalPrice,
        discountAmount: data.discountAmount,
        finalPrice: data.finalPrice,
      };

      setAppliedPromo(promo);
      setBookingStore({ appliedPromoCode: promo });
      setPromoInput("");
    } catch {
      setPromoError("Failed to validate promo code. Please try again.");
    } finally {
      setPromoLoading(false);
    }
  }

  /** Removes the currently applied promo code. */
  function handleRemovePromo() {
    setAppliedPromo(null);
    setBookingStore({ appliedPromoCode: null });
    setPromoError(null);
  }

  /**
   * DEV ONLY — books the selected session without any payment.
   * Calls /api/dev/book-free which is a hard 404 outside development.
   */
  async function handleDevBypass() {
    if (!store) return;
    setDevError(null);
    setDevBypassing(true);
    try {
      const response = await fetch("/api/dev/book-free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: store.sessionId,
          customerId: store.customerId,
          customerEmail: store.customerDetails?.email,
          customerFirstName: store.customerDetails?.firstName,
          className: store.sessionDetails?.className,
          startsAt: store.sessionDetails?.startsAt,
          locationName: store.sessionDetails?.locationName,
          locationAddress: store.sessionDetails?.locationAddress,
          locationCity: store.sessionDetails?.locationCity,
          locationState: store.sessionDetails?.locationState,
          locationZip: store.sessionDetails?.locationZip,
        }),
      });
      const result = await response.json().catch(() => ({ success: false }));
      if (result.success) {
        router.push("/book/confirmation");
      } else {
        setDevError(result.error ?? "Dev bypass failed.");
      }
    } catch {
      setDevError("Network error — dev bypass failed.");
    } finally {
      setDevBypassing(false);
    }
  }

  /**
   * Handles 100% off promo bookings — skips PayPal, calls confirm-free directly.
   * Only reachable when appliedPromo.finalPrice === 0.
   */
  async function handleFreeBooking() {
    if (!store || !appliedPromo) return;
    setPaymentError(null);
    setIsFullError(false);

    const response = await fetch("/api/bookings/confirm-free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: store.sessionId,
        customerId: store.customerId,
        promoCode: appliedPromo.code,
        customerEmail: store.customerDetails?.email,
        customerFirstName: store.customerDetails?.firstName,
        className: store.sessionDetails?.className,
        startsAt: store.sessionDetails?.startsAt,
        locationName: store.sessionDetails?.locationName,
        locationAddress: store.sessionDetails?.locationAddress,
        locationCity: store.sessionDetails?.locationCity,
        locationState: store.sessionDetails?.locationState,
        locationZip: store.sessionDetails?.locationZip,
      }),
    });

    const result = (await response.json().catch(() => ({ success: false }))) as {
      success?: boolean;
      error?: string;
    };

    if (result.success) {
      router.push("/book/confirmation");
      return;
    }

    if (response.status === 409) {
      setIsFullError(true);
      return;
    }

    setPaymentError(result.error ?? "Something went wrong. Please refresh and try again.");
  }

  /**
   * Called by PayPalOneTimePaymentButton createOrder callback.
   * Passes the applied promo code so the server creates the order at the discounted price.
   */
  async function handlePayPalCreate() {
    if (!store?.sessionDetails || !store.sessionId) throw new Error("No session selected");

    const response = await fetch("/api/paypal/create-booking-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: store.sessionId,
        promoCode: appliedPromo?.code ?? null,
      }),
    });

    const data = await response.json().catch(() => ({ orderId: null }));
    if (!data.orderId) throw new Error("Failed to create PayPal order");
    return { orderId: data.orderId as string };
  }

  /**
   * Called by PayPalOneTimePaymentButton onApprove callback.
   * Passes the applied promo code so the server re-validates and captures the correct amount.
   */
  async function handlePayPalApprove({ orderId }: OnApproveDataOneTimePayments) {
    setPaymentError(null);
    setIsFullError(false);
    if (!store) return;

    const finalAmount = appliedPromo ? appliedPromo.finalPrice : store.sessionDetails?.price;

    const response = await fetch("/api/bookings/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: orderId,
        sessionId: store.sessionId,
        customerId: store.customerId,
        amount: finalAmount,
        promoCode: appliedPromo?.code ?? null,
        customerEmail: store.customerDetails?.email,
        customerFirstName: store.customerDetails?.firstName,
        className: store.sessionDetails?.className,
        startsAt: store.sessionDetails?.startsAt,
        locationName: store.sessionDetails?.locationName,
        locationAddress: store.sessionDetails?.locationAddress,
        locationCity: store.sessionDetails?.locationCity,
        locationState: store.sessionDetails?.locationState,
        locationZip: store.sessionDetails?.locationZip,
      }),
    });

    const result = (await response.json().catch(() => ({ success: false }))) as {
      success?: boolean;
      error?: string;
    };

    if (result.success) {
      router.push("/book/confirmation");
      return;
    }

    const serverError = typeof result.error === "string" ? result.error : "";

    if (response.status === 409 && serverError.toLowerCase().includes("class filled")) {
      setIsFullError(true);
      return;
    }

    if (/refunded|reversed/i.test(serverError)) {
      const cleanError = serverError.replace(/\s*Payment refunded\.?$/i, "").trim();
      setPaymentError(
        `${cleanError || "We couldn't finish your booking."} ` +
        "Any payment captured for this attempt has been refunded automatically. " +
        "Please select another session or contact us at (813) 966-3969 if you need help."
      );
      return;
    }

    if (serverError) {
      setPaymentError(`${serverError} Please refresh and try again.`);
      return;
    }

    setPaymentError(
      "Your payment was received but we couldn't confirm your booking. " +
      "Please contact us at (813) 966-3969 with your PayPal transaction details."
    );
  }

  const isFreeWithPromo = appliedPromo !== null && appliedPromo.finalPrice === 0;

  return (
    <PayPalProvider
      clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
      environment={process.env.NEXT_PUBLIC_PAYPAL_ENV === "production" ? "production" : "sandbox"}
      components={["paypal-payments"]}
      pageType="checkout"
    >
      <div className="min-h-screen bg-white">
        <BookingProgress currentStep={4} />

        <div className="max-w-5xl mx-auto px-4 pb-16">
          <div className="flex flex-col lg:flex-row gap-10">

            {/* ── Left: payment section ── */}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment</h1>
              <p className="text-gray-500 text-sm mb-8">
                {isFreeWithPromo
                  ? "Your promo code covers the full cost. Complete your booking below."
                  : "Review your order below and complete payment with PayPal."}
              </p>

              {/* Class full error */}
              {isFullError && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-4 text-sm mb-6">
                  <p className="font-semibold mb-1">This class just filled up.</p>
                  <p>
                    We&apos;re sorry — this class filled up while you were checking out.
                    {!isFreeWithPromo && " Any payment captured for this attempt has been refunded automatically."}
                    {" "}Please select another session.
                  </p>
                  <button
                    onClick={() => router.push("/book")}
                    className="mt-3 text-red-700 font-semibold underline hover:text-red-800"
                  >
                    Choose another class
                  </button>
                </div>
              )}

              {/* Generic payment error */}
              {paymentError && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
                  {paymentError}
                </div>
              )}

              {/* Order summary */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Your Booking
                </h2>
                <OrderSummary
                  details={store?.sessionDetails ?? null}
                  appliedPromoCode={appliedPromo}
                />
              </div>

              {/* ── Promo code input ── */}
              {!isFullError && store?.sessionDetails && (
                <div className="mb-8">
                  {appliedPromo ? (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-green-800">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                        </svg>
                        <span>
                          Promo <span className="font-semibold">{appliedPromo.code}</span> applied
                          {" "}(−{appliedPromo.discountAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })})
                        </span>
                      </div>
                      <button
                        onClick={handleRemovePromo}
                        className="text-xs text-green-700 underline hover:text-green-900 ml-4 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Promo code
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={promoInput}
                          onChange={(e) => {
                            setPromoInput(e.target.value.toUpperCase());
                            setPromoError(null);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") handleApplyPromo(); }}
                          placeholder="Enter code"
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent uppercase placeholder:normal-case"
                          disabled={promoLoading}
                        />
                        <button
                          onClick={handleApplyPromo}
                          disabled={promoLoading || !promoInput.trim()}
                          className="px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {promoLoading ? "Checking…" : "Apply"}
                        </button>
                      </div>
                      {promoError && (
                        <p role="alert" className="mt-2 text-sm text-red-600">{promoError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Payment action — either PayPal or free booking button */}
              {!isFullError && store?.sessionDetails && (
                <div className="max-w-sm">
                  {isFreeWithPromo ? (
                    <button
                      onClick={handleFreeBooking}
                      className="w-full py-3 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg text-sm transition-colors"
                    >
                      Complete Booking (Free)
                    </button>
                  ) : (
                    <PayPalOneTimePaymentButton
                      presentationMode="auto"
                      createOrder={handlePayPalCreate}
                      onApprove={handlePayPalApprove}
                      onError={(err) => {
                        console.error("PayPal error:", err);
                        setPaymentError("PayPal encountered an error. Please try again or use a different payment method.");
                      }}
                    />
                  )}
                </div>
              )}

              {/* Loading state while store hydrates */}
              {!store && (
                <div className="h-14 w-full max-w-sm bg-gray-100 animate-pulse rounded-lg" />
              )}

              {/* ── DEV ONLY: skip payment button ─────────────────────────── */}
              {process.env.NODE_ENV === "development" && !isFullError && store?.sessionDetails && (
                <div className="mt-6 max-w-sm border border-dashed border-yellow-400 rounded-lg p-4 bg-yellow-50">
                  <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-2">
                    Dev only — skip payment
                  </p>
                  <p className="text-xs text-yellow-600 mb-3">
                    Books the spot with $0 recorded as cash. Use this to test the full rollcall → grading → Enrollware flow without a real PayPal transaction.
                  </p>
                  {devError && (
                    <p className="text-xs text-red-600 mb-2">{devError}</p>
                  )}
                  <button
                    onClick={handleDevBypass}
                    disabled={devBypassing}
                    className="w-full py-2 px-4 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-yellow-900 font-semibold rounded-lg text-sm transition-colors"
                  >
                    {devBypassing ? "Booking…" : "Book without paying (dev)"}
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </PayPalProvider>
  );
}

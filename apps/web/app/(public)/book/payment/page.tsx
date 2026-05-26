"use client";

/**
 * /book/payment — Step 4 of the booking wizard: PayPal checkout.
 * Uses PayPal v9 API (PayPalProvider + PayPalOneTimePaymentButton from sdk-v6).
 * Calls /api/paypal/create-booking-order to create the order server-side,
 * then /api/bookings/confirm to capture payment and create the booking record.
 * Used by: booking flow after account creation (step 3) or sign-in (step 2a).
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PayPalProvider,
  PayPalOneTimePaymentButton,
} from "@paypal/react-paypal-js/sdk-v6";
import type { OnApproveDataOneTimePayments } from "@paypal/react-paypal-js/sdk-v6";
import { getBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import type { BookingStore } from "@/lib/booking-store";

/** Renders Step 4 — PayPal payment for the selected session. */
export default function BookPaymentPage() {
  const router = useRouter();
  // Initialize store once from localStorage. If required steps are missing, store is null.
  const [store] = useState<BookingStore | null>(() => {
    const s = getBookingStore();
    return s.sessionId && s.customerId ? s : null;
  });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isFullError, setIsFullError] = useState(false);

  // Guards: redirect if required prior steps are incomplete
  useEffect(() => {
    if (!store) {
      const s = getBookingStore();
      if (!s.sessionId) router.replace("/book");
      else router.replace("/book/details");
    }
  }, [store, router]);

  /**
   * Called by PayPalOneTimePaymentButton createOrder callback.
   * Calls our server to create the PayPal order (with routing resolved server-side
   * to either the instructor's PayPal or the business PayPal) and returns { orderId }.
   */
  async function handlePayPalCreate() {
    if (!store?.sessionDetails || !store.sessionId) throw new Error("No session selected");

    const response = await fetch("/api/paypal/create-booking-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // sessionId is enough: price, class name, and payment routing are all
        // re-fetched server-side so stale client state cannot create a bad order.
        sessionId: store.sessionId,
      }),
    });

    const data = await response.json().catch(() => ({ orderId: null }));
    if (!data.orderId) throw new Error("Failed to create PayPal order");
    return { orderId: data.orderId as string };
  }

  /**
   * Called by PayPalOneTimePaymentButton onApprove callback.
   * Sends the approved orderId to our server for capture + booking creation.
   */
  async function handlePayPalApprove({ orderId }: OnApproveDataOneTimePayments) {
    setPaymentError(null);
    setIsFullError(false);
    if (!store) return;

    const response = await fetch("/api/bookings/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paypalOrderId: orderId,
        sessionId: store.sessionId,
        customerId: store.customerId,
        amount: store.sessionDetails?.price,
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

    // Class filled up during checkout. The server refunds any captured payment
    // before returning this error, so the page should guide the customer back to
    // session selection instead of asking them to contact support first.
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

  return (
    // PayPalProvider must wrap the entire return — mounting inside a conditional
    // causes React 19 to block the injected <script> tag on re-mount
    <PayPalProvider
      clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
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
                Review your order below and complete payment with PayPal.
              </p>

              {/* Class full error — class filled during checkout */}
              {isFullError && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-4 text-sm mb-6">
                  <p className="font-semibold mb-1">This class just filled up.</p>
                  <p>
                    We&apos;re sorry — this class filled up while you were checking out.
                    Any payment captured for this attempt has been refunded automatically.
                    Please select another session.
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

              {/* Order summary — always shown above PayPal button */}
              <div className="mb-8">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Your Booking
                </h2>
                <OrderSummary details={store?.sessionDetails ?? null} />
              </div>

              {/* PayPal button */}
              {!isFullError && store?.sessionDetails && (
                <div className="max-w-sm">
                  <PayPalOneTimePaymentButton
                    presentationMode="auto"
                    createOrder={handlePayPalCreate}
                    onApprove={handlePayPalApprove}
                    onError={(err) => {
                      console.error("PayPal error:", err);
                      setPaymentError("PayPal encountered an error. Please try again or use a different payment method.");
                    }}
                  />
                </div>
              )}

              {/* Loading state while store hydrates */}
              {!store && (
                <div className="h-14 w-full max-w-sm bg-gray-100 animate-pulse rounded-lg" />
              )}
            </div>


          </div>
        </div>
      </div>
    </PayPalProvider>
  );
}

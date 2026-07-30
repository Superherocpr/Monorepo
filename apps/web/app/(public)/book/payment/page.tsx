"use client";

/**
 * /book/payment — Step 4 of the booking wizard: card or PayPal checkout.
 * Uses PayPal v9 SDK (PayPalProvider + card fields as primary, PayPalOneTimePaymentButton
 * as secondary). Calls /api/paypal/client-token on mount to initialize the SDK, then
 * /api/paypal/create-booking-order to create the order, and /api/bookings/confirm to
 * capture payment and create the booking record.
 * For 100% promo codes, calls /api/bookings/confirm-free instead (no PayPal).
 * Used by: booking flow after account creation (step 3) or sign-in (step 2a).
 */

import { useState, useEffect, useRef, useCallback, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import {
  PayPalProvider,
  PayPalOneTimePaymentButton,
  PayPalCardFieldsProvider,
  PayPalCardNumberField,
  PayPalCardExpiryField,
  PayPalCardCvvField,
  usePayPalCardFieldsOneTimePaymentSession,
} from "@paypal/react-paypal-js/sdk-v6";
import type {
  OnApproveDataOneTimePayments,
  UsePayPalCardFieldsOneTimePaymentSessionResult,
} from "@paypal/react-paypal-js/sdk-v6";
import { Lock, ShieldCheck } from "lucide-react";
import { getBookingStore, setBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import OrderSummary from "../_components/OrderSummary";
import CardBrandIcons from "../_components/CardBrandIcons";
import type { BookingStore, AppliedPromoCode, SelectedAddon } from "@/lib/booking-store";
import type { PromoValidateResponse } from "@/app/api/promo-codes/validate/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by handlePayPalCreate — passed to card form and PayPal button. */
type CreateOrderResult = { orderId: string };

/** Props for the inner card form component. */
type CardPaymentFormProps = {
  /** Creates the PayPal order and returns its ID. Called on every Pay click. */
  onCreateOrder: () => Promise<CreateOrderResult>;
  /** Called when PayPal has authorized the payment (before capture). */
  onApprove: (data: { orderId: string }) => Promise<void>;
  /** Called when a card-level error should surface to the page. */
  onError: (message: string) => void;
  /** Total amount in USD to display on the pay button. */
  amount: number;
  /** Whether the pay button should be disabled (e.g. class just filled). */
  disabled: boolean;
};

// ---------------------------------------------------------------------------
// CardPaymentForm — inner component; must live inside PayPalCardFieldsProvider
// ---------------------------------------------------------------------------

/**
 * Renders the hosted card fields (number, expiry, CVV) and submit button.
 * Must be rendered inside `PayPalCardFieldsProvider`. Uses
 * `usePayPalCardFieldsOneTimePaymentSession` to submit card data to PayPal.
 * Used by: BookPaymentPage.
 */
function CardPaymentForm({
  onCreateOrder,
  onApprove,
  onError,
  amount,
  disabled,
}: CardPaymentFormProps): ReactElement {
  const { submit, submitResponse, error }: UsePayPalCardFieldsOneTimePaymentSessionResult =
    usePayPalCardFieldsOneTimePaymentSession();

  const [nameOnCard, setNameOnCard] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  // Stable ref so the useEffect below can call the latest onApprove without
  // it appearing in the dependency array (avoids stale-closure re-render loops).
  const onApproveRef = useRef(onApprove);
  onApproveRef.current = onApprove;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Handle SDK-level errors (initialization failure, eligibility issues).
  useEffect(() => {
    if (!error) return;
    console.error("[CardPaymentForm] card fields error:", error);
    setCardError("Card payment is temporarily unavailable. Please use PayPal below.");
    setIsSubmitting(false);
  }, [error]);

  // Handle submit response states from PayPal after card data is submitted.
  useEffect(() => {
    if (!submitResponse) return;

    const handleResponse = async (): Promise<void> => {
      switch (submitResponse.state) {
        case "succeeded":
          // PayPal authorized the card — now capture server-side via /api/bookings/confirm.
          await onApproveRef.current({ orderId: submitResponse.data.orderId });
          // If we reach here, confirm returned an error (no redirect happened).
          setIsSubmitting(false);
          break;

        case "canceled":
          // Buyer dismissed 3DS challenge — allow retry without recreating the session.
          setCardError("Authentication was canceled. Please try again.");
          setIsSubmitting(false);
          break;

        case "failed":
          setCardError(
            submitResponse.data.message ??
              "Payment failed. Please check your card details and try again."
          );
          setIsSubmitting(false);
          break;
      }
    };

    handleResponse().catch((err: unknown) => {
      console.error("[CardPaymentForm] handleResponse error:", err);
      setIsSubmitting(false);
    });
  }, [submitResponse]);

  /** Creates a PayPal order then submits the card data against it. */
  async function handlePay(): Promise<void> {
    setCardError(null);
    setIsSubmitting(true);
    try {
      const { orderId } = await onCreateOrder();
      await submit(orderId, { name: nameOnCard.trim() || undefined });
      // Response arrives via the submitResponse useEffect above.
    } catch (err) {
      console.error("[CardPaymentForm] submit error:", err);
      setCardError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  /**
   * Style injected directly into PayPal's hosted <input> — this is the ONLY
   * place border/background/radius should be set. Giving the wrapping
   * container its own bordered/rounded box AND styling PayPal's real input
   * produced a visible "double box" (our box behind PayPal's own input
   * chrome). The container below is intentionally unstyled and only sizes
   * the iframe; every visual property lives here instead.
   */
  const fieldStyle = {
    input: {
      fontSize: "14px",
      color: "#111827",
      fontFamily: "inherit",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      background: "#ffffff",
      padding: "0 12px",
      height: "42px",
    },
    "input::placeholder": {
      color: "#9ca3af",
    },
    "input.focus": {
      border: "1px solid transparent",
      outline: "none",
      boxShadow: "0 0 0 2px #ef4444",
    },
  };

  /** Sizes the iframe only — no visual styling here (see fieldStyle above). */
  const fieldContainerStyle = { height: "42px" };

  const formattedAmount = amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <div className="space-y-4">
      {/* Name on card — regular input; passed to PayPal submit options */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Name on card
        </label>
        <input
          type="text"
          value={nameOnCard}
          onChange={(e) => setNameOnCard(e.target.value)}
          placeholder="Jane Smith"
          autoComplete="cc-name"
          disabled={isSubmitting || disabled}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50"
        />
      </div>

      {/* Card number — PayPal hosted iframe */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Card number
          </label>
          <CardBrandIcons />
        </div>
        <PayPalCardNumberField
          placeholder="1234 5678 9012 3456"
          ariaLabel="Card number"
          style={fieldStyle}
          containerStyles={fieldContainerStyle}
        />
      </div>

      {/* Expiry + CVV — side by side */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Expiry
          </label>
          <PayPalCardExpiryField
            placeholder="MM / YY"
            ariaLabel="Card expiry date"
            style={fieldStyle}
            containerStyles={fieldContainerStyle}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            CVV
          </label>
          <PayPalCardCvvField
            placeholder="123"
            ariaLabel="Card security code"
            style={fieldStyle}
            containerStyles={fieldContainerStyle}
          />
        </div>
      </div>

      {/* Card-level error */}
      {cardError && (
        <p role="alert" className="text-sm text-red-600">
          {cardError}
        </p>
      )}

      {/* Pay button */}
      <button
        onClick={handlePay}
        disabled={isSubmitting || disabled}
        className="w-full py-3 px-6 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <>
            <svg
              className="animate-spin h-4 w-4 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Processing…
          </>
        ) : (
          `Pay ${formattedAmount}`
        )}
      </button>

      {/* Security note */}
      <div className="flex items-center gap-4 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <Lock size={13} className="text-gray-400 shrink-0" aria-hidden="true" />
          SSL encrypted
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <ShieldCheck size={13} className="text-gray-400 shrink-0" aria-hidden="true" />
          PCI DSS compliant
        </span>
      </div>
      <p className="text-xs text-gray-400">
        Card details are entered directly into PayPal&apos;s secure servers and are never stored by us.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BookPaymentPage — main page component
// ---------------------------------------------------------------------------

/** Renders Step 4 — card payment (primary) or PayPal (secondary) for the selected session. */
export default function BookPaymentPage(): ReactElement {
  const router = useRouter();
  const [store] = useState<BookingStore | null>(() => {
    const s = getBookingStore();
    return s.sessionId && s.customerId ? s : null;
  });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isFullError, setIsFullError] = useState(false);

  // PayPal SDK requires a clientToken (not clientId) when card-fields are enabled.
  const [clientToken, setClientToken] = useState<string | undefined>(undefined);
  const [clientTokenError, setClientTokenError] = useState(false);

  // Promo code state
  const [promoInput, setPromoInput] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromoCode | null>(
    () => getBookingStore().appliedPromoCode ?? null
  );

  // Add-on selection state
  const [availableAddons, setAvailableAddons] = useState<SelectedAddon[]>([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>(
    () => getBookingStore().selectedAddons.map((a) => a.id)
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

  // Fetch the PayPal client token needed to initialize the SDK with card fields.
  // A non-OK response or a missing token must flip clientTokenError — otherwise
  // clientToken stays undefined, PayPalProvider never initializes, and the page
  // renders its loading skeleton forever with no indication anything is wrong.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/paypal/client-token")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Client token request failed (${res.status})`);
        const data = (await res.json()) as { clientToken?: string };
        if (!data.clientToken) throw new Error("Client token missing from response");
        return data.clientToken;
      })
      .then((token) => {
        if (!cancelled) setClientToken(token);
      })
      .catch((err: unknown) => {
        console.error("[book/payment] PayPal client token fetch failed:", err);
        if (!cancelled) setClientTokenError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the add-ons this session's instructor has enabled (if any).
  useEffect(() => {
    if (!store?.sessionId) return;
    let cancelled = false;
    fetch(`/api/sessions/${store.sessionId}/addons`)
      .then((res) => res.json())
      .then((data: { addons?: SelectedAddon[] }) => {
        if (!cancelled) setAvailableAddons(data.addons ?? []);
      })
      .catch(() => {
        if (!cancelled) setAvailableAddons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [store?.sessionId]);

  /** Toggles an add-on selection and persists the denormalized list to the store. */
  function toggleAddon(addon: SelectedAddon): void {
    setSelectedAddonIds((prev) => {
      const next = prev.includes(addon.id)
        ? prev.filter((id) => id !== addon.id)
        : [...prev, addon.id];
      setBookingStore({
        selectedAddons: availableAddons.filter((a) => next.includes(a.id)),
      });
      return next;
    });
  }

  const selectedAddons = availableAddons.filter((a) => selectedAddonIds.includes(a.id));
  const addonsTotal = selectedAddons.reduce((sum, a) => sum + a.price, 0);

  /** Applies a promo code by calling the validate endpoint and storing the result. */
  async function handleApplyPromo(): Promise<void> {
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
  function handleRemovePromo(): void {
    setAppliedPromo(null);
    setBookingStore({ appliedPromoCode: null });
    setPromoError(null);
  }

  /**
   * DEV ONLY — books the selected session without any payment.
   * Calls /api/dev/book-free which is a hard 404 outside development.
   */
  async function handleDevBypass(): Promise<void> {
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
  async function handleFreeBooking(): Promise<void> {
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
   * Called before card submission and by the PayPalOneTimePaymentButton createOrder callback.
   * Passes the applied promo code so the server creates the order at the discounted price.
   * @returns An object containing the new PayPal order ID.
   */
  const handlePayPalCreate = useCallback(async (): Promise<CreateOrderResult> => {
    if (!store?.sessionDetails || !store.sessionId) throw new Error("No session selected");

    const response = await fetch("/api/paypal/create-booking-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: store.sessionId,
        promoCode: appliedPromo?.code ?? null,
        addonIds: selectedAddonIds,
      }),
    });

    const data = await response.json().catch(() => ({ orderId: null }));
    if (!data.orderId) throw new Error("Failed to create PayPal order");
    return { orderId: data.orderId as string };
  }, [store, appliedPromo, selectedAddonIds]);

  /**
   * Called after PayPal authorizes the payment (card fields OR PayPal button onApprove).
   * Captures the payment server-side and creates the booking record.
   * @param orderId - The PayPal order ID to capture.
   */
  const handlePayPalApprove = useCallback(
    async ({ orderId }: { orderId: string } | OnApproveDataOneTimePayments): Promise<void> => {
      setPaymentError(null);
      setIsFullError(false);
      if (!store) return;

      const classAmount = appliedPromo ? appliedPromo.finalPrice : store.sessionDetails?.price ?? 0;
      const finalAmount = classAmount + addonsTotal;

      const response = await fetch("/api/bookings/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paypalOrderId: orderId,
          sessionId: store.sessionId,
          customerId: store.customerId,
          amount: finalAmount,
          promoCode: appliedPromo?.code ?? null,
          addonIds: selectedAddonIds,
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
        declined?: boolean;
      };

      if (result.success) {
        router.push("/book/confirmation");
        return;
      }

      const serverError = typeof result.error === "string" ? result.error : "";

      // 402 = the capture never settled (declined / pending). No booking was
      // created and no money was taken, so tell the buyer to try another card
      // rather than the generic "refresh and try again".
      if (response.status === 402) {
        setPaymentError(
          serverError ||
            "Your card was declined and no payment was taken. Please try a different card."
        );
        return;
      }

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
    },
    [store, appliedPromo, addonsTotal, selectedAddonIds, router]
  );

  // Add-ons always cost money, so a promo covering the class price alone
  // doesn't make the checkout free if the customer selected any add-ons.
  const isFreeWithPromo =
    appliedPromo !== null && appliedPromo.finalPrice === 0 && addonsTotal === 0;

  const classAmount = appliedPromo
    ? appliedPromo.finalPrice
    : store?.sessionDetails?.price ?? 0;
  const totalAmount = classAmount + addonsTotal;

  const paypalEnvironment =
    process.env.NEXT_PUBLIC_PAYPAL_ENV === "production" ? "production" : "sandbox";

  const pageContent = (
      <div className="min-h-screen bg-white">
        <BookingProgress currentStep={4} />

        <div className="max-w-4xl mx-auto px-4 pb-16">
          <div className="flex flex-col lg:flex-row gap-8">

            {/* ── Left: payment section — capped width so it sits close to the sidebar
                 instead of stretching across the remaining flex space ── */}
            <div className="order-2 lg:order-1 w-full lg:max-w-md">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment</h1>
              <p className="text-gray-500 text-sm mb-8">
                {isFreeWithPromo
                  ? "Your promo code covers the full cost. Complete your booking below."
                  : "Pay securely with your debit or credit card, or use PayPal."}
              </p>

              {/* Class full error */}
              {isFullError && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-4 text-sm mb-6"
                >
                  <p className="font-semibold mb-1">This class just filled up.</p>
                  <p>
                    We&apos;re sorry — this class filled up while you were checking out.
                    {!isFreeWithPromo &&
                      " Any payment captured for this attempt has been refunded automatically."}
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
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6"
                >
                  {paymentError}
                </div>
              )}

              {/* Payment action */}
              {!isFullError && store?.sessionDetails && (
                <div>
                  {isFreeWithPromo ? (
                    /* ── Free booking (100% promo) ── */
                    <button
                      onClick={handleFreeBooking}
                      className="w-full py-3 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg text-sm transition-colors"
                    >
                      Complete Booking (Free)
                    </button>
                  ) : clientTokenError ? (
                    /* ── Client token fetch failed — PayPal button only fallback ── */
                    <div className="space-y-4">
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Card payment couldn&apos;t load. You can still pay with PayPal below.
                      </p>
                      <PayPalOneTimePaymentButton
                        presentationMode="auto"
                        createOrder={handlePayPalCreate}
                        onApprove={handlePayPalApprove}
                        onError={(err) => {
                          console.error("PayPal error:", err);
                          setPaymentError(
                            "PayPal encountered an error. Please try again or contact us at (813) 966-3969."
                          );
                        }}
                      />
                    </div>
                  ) : !clientToken ? (
                    /* ── Loading: client token not yet fetched ── */
                    <div className="space-y-3 animate-pulse">
                      <div className="h-10 bg-gray-100 rounded-lg" />
                      <div className="h-10 bg-gray-100 rounded-lg" />
                      <div className="grid grid-cols-2 gap-4">
                        <div className="h-10 bg-gray-100 rounded-lg" />
                        <div className="h-10 bg-gray-100 rounded-lg" />
                      </div>
                      <div className="h-12 bg-gray-100 rounded-lg" />
                    </div>
                  ) : (
                    /* ── Primary: card form + secondary: PayPal button ── */
                    <div className="space-y-6">
                      {/* Card form */}
                      <PayPalCardFieldsProvider>
                        <CardPaymentForm
                          onCreateOrder={handlePayPalCreate}
                          onApprove={handlePayPalApprove}
                          onError={(msg) => setPaymentError(msg)}
                          amount={totalAmount}
                          disabled={false}
                        />
                      </PayPalCardFieldsProvider>

                      {/* Divider */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                          or pay with
                        </span>
                        <div className="flex-1 h-px bg-gray-200" />
                      </div>

                      {/* PayPal button — secondary option */}
                      <PayPalOneTimePaymentButton
                        presentationMode="auto"
                        createOrder={handlePayPalCreate}
                        onApprove={handlePayPalApprove}
                        onError={(err) => {
                          console.error("PayPal error:", err);
                          setPaymentError(
                            "PayPal encountered an error. Please try again or contact us at (813) 966-3969."
                          );
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Loading state while booking store hydrates */}
              {!store && (
                <div className="h-14 w-full bg-gray-100 animate-pulse rounded-lg" />
              )}

              {/* ── DEV ONLY: skip payment button ── */}
              {process.env.NODE_ENV === "development" &&
                !isFullError &&
                store?.sessionDetails && (
                  <div className="mt-6 border border-dashed border-yellow-400 rounded-lg p-4 bg-yellow-50">
                    <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-2">
                      Dev only — skip payment
                    </p>
                    <p className="text-xs text-yellow-600 mb-3">
                      Books the spot with $0 recorded as cash. Use this to test the full
                      rollcall → grading → Enrollware flow without a real PayPal transaction.
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

            {/* ── Right: booking info + promo code — appears first on mobile,
                 to the right of payment on desktop ── */}
            <div className="order-1 lg:order-2 w-full lg:w-80 shrink-0">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Your Booking
              </h2>
              <OrderSummary
                details={store?.sessionDetails ?? null}
                appliedPromoCode={appliedPromo}
                selectedAddons={selectedAddons}
              />

              {/* ── Add-ons — only shown when the instructor enabled at least one ── */}
              {!isFullError && store?.sessionDetails && availableAddons.length > 0 && (
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Add-ons <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <div className="space-y-2 border border-gray-200 rounded-lg p-3">
                    {availableAddons.map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAddonIds.includes(a.id)}
                          onChange={() => toggleAddon(a)}
                          className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <span>
                          {a.name}{" "}
                          <span className="text-gray-400">
                            (
                            {a.price.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                            })}
                            )
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Promo code input ── */}
              {!isFullError && store?.sessionDetails && (
                <div className="mt-6">
                  {appliedPromo ? (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-green-800">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="w-4 h-4 shrink-0"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>
                          Promo <span className="font-semibold">{appliedPromo.code}</span>{" "}
                          applied (−
                          {appliedPromo.discountAmount.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                          })}
                          )
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
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleApplyPromo();
                          }}
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
                        <p role="alert" className="mt-2 text-sm text-red-600">
                          {promoError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
  );

  // Card fields require a clientToken. When that fetch fails (missing/invalid
  // PayPal credentials, or the account not being approved for Advanced Cards),
  // fall back to a clientId-only provider so the PayPal button still works —
  // passing an undefined clientToken would leave the SDK uninitialized and
  // break every payment method on the page, not just the card form.
  if (clientTokenError) {
    return (
      <PayPalProvider
        clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""}
        environment={paypalEnvironment}
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
      environment={paypalEnvironment}
      components={["card-fields", "paypal-payments"]}
      pageType="checkout"
    >
      {pageContent}
    </PayPalProvider>
  );
}

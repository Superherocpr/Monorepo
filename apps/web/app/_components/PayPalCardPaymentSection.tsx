"use client";

/**
 * Shared PayPal card-payment section used by the public booking page and
 * admin manual charge register.
 */
import { useState, useEffect, useRef, useCallback, type ReactElement } from "react";
import {
  PayPalCardFieldsProvider,
  PayPalCardNumberField,
  PayPalCardExpiryField,
  PayPalCardCvvField,
  usePayPalCardFieldsOneTimePaymentSession,
} from "@paypal/react-paypal-js/sdk-v6";
import CardBrandIcons from "@/app/(public)/book/_components/CardBrandIcons";

/** Shape returned by a createOrder callback. */
export type CreateOrderResult = { orderId: string };

/** Validity of one hosted card field. */
type FieldValidity = { isValid: boolean; isEmpty: boolean; isPotentiallyValid: boolean };

/** Validity of the three hosted card fields. */
type CardFieldsValidity = {
  number: FieldValidity;
  expiry: FieldValidity;
  cvv: FieldValidity;
};

const PRISTINE_FIELD: FieldValidity = {
  isValid: false,
  isEmpty: true,
  isPotentiallyValid: true,
};

const PRISTINE_VALIDITY: CardFieldsValidity = {
  number: PRISTINE_FIELD,
  expiry: PRISTINE_FIELD,
  cvv: PRISTINE_FIELD,
};

const FIELD_LABELS: Record<keyof CardFieldsValidity, string> = {
  number: "card number",
  expiry: "expiry date",
  cvv: "security code",
};

function isRecoverableCardError(err: Error | null): boolean {
  const message = err?.message ?? "";
  return /invalid card data|empty or invalid|form submit failed/i.test(message);
}

interface CardPaymentFormProps {
  onCreateOrder: () => Promise<CreateOrderResult>;
  onApprove: (data: { orderId: string }) => Promise<void>;
  onError: (message: string) => void;
  amount: number;
  disabled: boolean;
  validity: CardFieldsValidity;
  /**
   * Shown when card payment is genuinely unusable (SDK init/eligibility
   * failure). Defaults to pointing the buyer at the PayPal button, which only
   * exists on the public booking page — the admin register must override this.
   */
  unavailableMessage?: string;
}

const DEFAULT_UNAVAILABLE_MESSAGE =
  "Card payment is temporarily unavailable. Please use PayPal below.";

function CardPaymentForm({
  onCreateOrder,
  onApprove,
  onError,
  amount,
  disabled,
  validity,
  unavailableMessage = DEFAULT_UNAVAILABLE_MESSAGE,
}: CardPaymentFormProps): ReactElement {
  const [nameOnCard, setNameOnCard] = useState("");
  const [payAttempted, setPayAttempted] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCardUnavailable, setIsCardUnavailable] = useState(false);

  const { submit, submitResponse, error } = usePayPalCardFieldsOneTimePaymentSession();

  // Latest-ref pattern: the effects below must call the newest callbacks without
  // re-running whenever the caller passes a new function identity — re-running
  // them would re-report an error or re-approve an order.
  //
  // The assignments live in an effect rather than in the render body (React
  // Compiler forbids mutating a ref during render). This effect is declared
  // FIRST on purpose: effects fire in declaration order within a commit, so the
  // refs are refreshed before either consuming effect below reads them.
  const onApproveRef = useRef(onApprove);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onApproveRef.current = onApprove;
    onErrorRef.current = onError;
  }, [onApprove, onError]);

  useEffect(() => {
    if (!error) return;
    const recoverable = isRecoverableCardError(error);
    const message = recoverable
      ? error.message || "Please check your card details and try again."
      : unavailableMessage;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to PayPal SDK error; no alternative pattern exists
    setCardError(message);
    onErrorRef.current(message);

    if (!recoverable) {
      setIsCardUnavailable(true);
    }
  }, [error, unavailableMessage]);

  useEffect(() => {
    if (!submitResponse) return;

    const handleResponse = async (): Promise<void> => {
      switch (submitResponse.state) {
        case "succeeded":
          await onApproveRef.current({ orderId: submitResponse.data.orderId });
          setIsSubmitting(false);
          break;
        case "canceled": {
          const message = "Authentication was canceled. Please try again.";
          setCardError(message);
          onErrorRef.current(message);
          setIsSubmitting(false);
          break;
        }
        case "failed": {
          const message =
            submitResponse.data.message ??
            "Payment failed. Please check your card details and try again.";
          setCardError(message);
          onErrorRef.current(message);
          setIsSubmitting(false);
          break;
        }
      }
    };

    handleResponse().catch((err: unknown) => {
      console.error("[CardPaymentForm] handleResponse error:", err);
      setIsSubmitting(false);
    });
  }, [submitResponse, onApprove]);

  const allFieldsValid =
    validity.number.isValid && validity.expiry.isValid && validity.cvv.isValid;

  // Derived rather than stored: the message must always name the fields that are
  // invalid *right now*. A stored string could resurface naming the wrong field if
  // the buyer fixed one field and then broke a different one after a failed attempt.
  const validationError =
    payAttempted && !allFieldsValid
      ? `Please enter a valid ${(Object.keys(FIELD_LABELS) as Array<keyof CardFieldsValidity>)
          .filter((field) => !validity[field].isValid)
          .map((field) => FIELD_LABELS[field])
          .join(", ")}.`
      : null;

  async function handlePay(): Promise<void> {
    setCardError(null);

    if (!allFieldsValid) {
      setPayAttempted(true);
      return;
    }

    setPayAttempted(false);
    setIsSubmitting(true);
    try {
      const { orderId } = await onCreateOrder();
      await submit(orderId, { name: nameOnCard.trim() || undefined });
    } catch (err) {
      console.error("[CardPaymentForm] submit error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      setCardError(message);
      onErrorRef.current(message);
      setIsSubmitting(false);
    }
  }

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

  const fieldContainerStyle = { height: "42px" };

  const formattedAmount = amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  function fieldError(field: keyof CardFieldsValidity): string | null {
    const state = validity[field];
    if (state.isEmpty || state.isPotentiallyValid) return null;
    return `Enter a valid ${FIELD_LABELS[field]}.`;
  }

  if (isCardUnavailable) {
    return (
      <p
        role="alert"
        className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
      >
        {cardError ?? unavailableMessage}
      </p>
    );
  }

  return (
    <div className="space-y-4">
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

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-gray-700">Card number</label>
          <CardBrandIcons />
        </div>
        <PayPalCardNumberField
          placeholder="1234 5678 9012 3456"
          ariaLabel="Card number"
          style={fieldStyle}
          containerStyles={fieldContainerStyle}
        />
        {fieldError("number") && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {fieldError("number")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Expiry</label>
          <PayPalCardExpiryField
            placeholder="MM / YY"
            ariaLabel="Card expiry date"
            style={fieldStyle}
            containerStyles={fieldContainerStyle}
          />
          {fieldError("expiry") && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {fieldError("expiry")}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">CVV</label>
          <PayPalCardCvvField
            placeholder="123"
            ariaLabel="Card security code"
            style={fieldStyle}
            containerStyles={fieldContainerStyle}
          />
          {fieldError("cvv") && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {fieldError("cvv")}
            </p>
          )}
        </div>
      </div>

      {(validationError || cardError) && (
        <p role="alert" className="text-sm text-red-700">
          {validationError ?? cardError}
        </p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={isSubmitting || disabled}
        className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors"
      >
        {isSubmitting ? "Processing…" : `Charge ${formattedAmount}`}
      </button>

      <div className="flex items-center gap-4 pt-1">
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          Card details are entered directly into PayPal&apos;s secure servers and are never stored by us.
        </span>
      </div>
    </div>
  );
}

/** Same props as the inner form, minus `validity` which this component owns. */
type CardPaymentSectionProps = Omit<CardPaymentFormProps, "validity">;

export function CardPaymentSection(props: CardPaymentSectionProps): ReactElement {
  const [validity, setValidity] = useState<CardFieldsValidity>(PRISTINE_VALIDITY);

  const handleValidityChange = useCallback((event: { data?: Partial<CardFieldsValidity> }) => {
    const data = event?.data;
    if (!data) return;
    setValidity((prev) => ({
      number: data.number ?? prev.number,
      expiry: data.expiry ?? prev.expiry,
      cvv: data.cvv ?? prev.cvv,
    }));
  }, []);

  return (
    <PayPalCardFieldsProvider validitychange={handleValidityChange}>
      <CardPaymentForm {...props} validity={validity} />
    </PayPalCardFieldsProvider>
  );
}

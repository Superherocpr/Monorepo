"use client";

/**
 * Staging-only stand-in for CardPaymentSection (PayPalCardPaymentSection.tsx).
 * Rendered by the "Add Student to Class" modal instead of the real PayPal
 * card-fields widget when /api/paypal/mock-status reports mock mode active —
 * see lib/mock-payments.ts for why this exists and what it guards.
 *
 * No PayPal SDK is loaded and no card is collected: there is nothing to
 * validate, so a click goes straight from onCreateOrder to onApprove, mirroring
 * the same two-step contract the real component's onClick handler follows.
 * The server-side routes behind onCreateOrder/onApprove independently re-check
 * mock mode before treating anything as mocked — this component controls only
 * what's rendered, not whether a charge is real.
 */
import { useState, type ReactElement } from "react";
import type { CreateOrderResult } from "./PayPalCardPaymentSection";

interface MockCardPaymentSectionProps {
  onCreateOrder: () => Promise<CreateOrderResult>;
  onApprove: (data: { orderId: string }) => Promise<void>;
  onError: (message: string) => void;
  amount: number;
  disabled: boolean;
}

export function MockCardPaymentSection({
  onCreateOrder,
  onApprove,
  onError,
  amount,
  disabled,
}: MockCardPaymentSectionProps): ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formattedAmount = amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  async function handleMockCharge(): Promise<void> {
    setIsSubmitting(true);
    try {
      const { orderId } = await onCreateOrder();
      await onApprove({ orderId });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Mock charge failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
        <span className="font-semibold">Mock payments active.</span> This
        environment does not charge real cards — clicking below simulates a
        successful charge with no PayPal call and no card entry.
      </div>

      <button
        type="button"
        onClick={() => void handleMockCharge()}
        disabled={isSubmitting || disabled}
        className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors"
      >
        {isSubmitting ? "Processing…" : `Simulate Charge ${formattedAmount}`}
      </button>
    </div>
  );
}

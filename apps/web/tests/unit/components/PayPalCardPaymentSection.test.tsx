/**
 * Unit tests for app/_components/PayPalCardPaymentSection.tsx.
 *
 * This component is on the money path — it is the primary card form for the
 * public booking flow, the team signup flow, and the admin manual charge
 * register. The properties locked in here are the ones whose failure would
 * either take payments down or take money incorrectly:
 *
 *   1. A valid card must reach `onCreateOrder` -> `submit`. If this breaks,
 *      nobody can pay.
 *   2. An invalid card must NOT reach `onCreateOrder`. Creating orders for
 *      cards that cannot be submitted leaves abandoned orders behind.
 *   3. The validation message must name the fields that are invalid *right
 *      now* — a stale message pointing at the wrong field sends the buyer to
 *      fix something that is already correct.
 *   4. `onApprove` must fire with the newest callback identity the parent
 *      passed. The component holds these in refs updated from an effect; if
 *      that ordering regressed, a successful charge would be reported to a
 *      stale closure and the booking would not be recorded.
 *
 * External dependencies mocked: the PayPal SDK (no network / no iframes) and
 * CardBrandIcons (pure presentation).
 */
import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

/** One hosted field's validity, mirroring the SDK's shape. */
type FieldValidity = { isValid: boolean; isEmpty: boolean; isPotentiallyValid: boolean };
type ValidityData = Partial<Record<"number" | "expiry" | "cvv", FieldValidity>>;

/** Mutable state the mocked SDK hook returns, so tests can drive the session. */
const session: {
  submit: Mock;
  submitResponse: unknown;
  error: Error | null;
} = { submit: vi.fn(), submitResponse: null, error: null };

/** Captured from the provider so tests can push validity changes into the tree. */
let pushValidity: ((event: { data?: ValidityData }) => void) | null = null;

vi.mock("@paypal/react-paypal-js/sdk-v6", () => ({
  PayPalCardFieldsProvider: ({
    children,
    validitychange,
  }: {
    children: ReactNode;
    validitychange: (event: { data?: ValidityData }) => void;
  }) => {
    pushValidity = validitychange;
    return <div>{children}</div>;
  },
  PayPalCardNumberField: () => <div data-testid="field-number" />,
  PayPalCardExpiryField: () => <div data-testid="field-expiry" />,
  PayPalCardCvvField: () => <div data-testid="field-cvv" />,
  usePayPalCardFieldsOneTimePaymentSession: () => session,
}));

vi.mock("@/app/(public)/book/_components/CardBrandIcons", () => ({
  default: () => <div data-testid="card-brands" />,
}));

import { CardPaymentSection } from "@/app/_components/PayPalCardPaymentSection";

const VALID: FieldValidity = { isValid: true, isEmpty: false, isPotentiallyValid: true };
/** Invalid but empty — suppresses the per-field message so assertions stay unambiguous. */
const BLANK: FieldValidity = { isValid: false, isEmpty: true, isPotentiallyValid: true };

/** Pushes a validity update through the provider inside act(). */
function setValidity(data: ValidityData): void {
  act(() => {
    pushValidity?.({ data });
  });
}

/** Clicks the charge button and flushes the resulting async work. */
async function clickCharge(): Promise<void> {
  await act(async () => {
    screen.getByRole("button", { name: /Charge/ }).click();
  });
}

/** Default props; individual tests override what they care about. */
function props(over: Partial<Parameters<typeof CardPaymentSection>[0]> = {}) {
  return {
    onCreateOrder: vi.fn().mockResolvedValue({ orderId: "ORDER-1" }),
    onApprove: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    amount: 50,
    disabled: false,
    ...over,
  };
}

describe("CardPaymentSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.submit = vi.fn().mockResolvedValue(undefined);
    session.submitResponse = null;
    session.error = null;
    pushValidity = null;
  });

  test("submits the order when every field is valid", async () => {
    const p = props();
    render(<CardPaymentSection {...p} />);

    setValidity({ number: VALID, expiry: VALID, cvv: VALID });
    await clickCharge();

    expect(p.onCreateOrder).toHaveBeenCalledOnce();
    expect(session.submit).toHaveBeenCalledWith("ORDER-1", { name: undefined });
  });

  test("does not create an order when a field is invalid", async () => {
    const p = props();
    render(<CardPaymentSection {...p} />);

    setValidity({ number: VALID, expiry: VALID, cvv: BLANK });
    await clickCharge();

    expect(p.onCreateOrder).not.toHaveBeenCalled();
    expect(session.submit).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter a valid security code.")).toBeInTheDocument();
  });

  test("retargets the message to whichever field is invalid now", async () => {
    render(<CardPaymentSection {...props()} />);

    setValidity({ number: VALID, expiry: VALID, cvv: BLANK });
    await clickCharge();
    expect(screen.getByText("Please enter a valid security code.")).toBeInTheDocument();

    // Buyer fixes the CVV but clears the card number. The message must follow.
    setValidity({ cvv: VALID, number: BLANK });

    expect(screen.getByText("Please enter a valid card number.")).toBeInTheDocument();
    expect(screen.queryByText("Please enter a valid security code.")).not.toBeInTheDocument();
  });

  test("clears the message once every field becomes valid", async () => {
    render(<CardPaymentSection {...props()} />);

    setValidity({ number: VALID, expiry: VALID, cvv: BLANK });
    await clickCharge();
    expect(screen.getByText("Please enter a valid security code.")).toBeInTheDocument();

    setValidity({ cvv: VALID });

    expect(screen.queryByText(/^Please enter a valid/)).not.toBeInTheDocument();
  });

  test("reports a succeeded submission to the newest onApprove", async () => {
    const stale = vi.fn().mockResolvedValue(undefined);
    const fresh = vi.fn().mockResolvedValue(undefined);
    const base = props();

    const { rerender } = render(<CardPaymentSection {...base} onApprove={stale} />);
    setValidity({ number: VALID, expiry: VALID, cvv: VALID });

    // The parent re-renders with a new callback identity in the same commit
    // that delivers the successful response.
    session.submitResponse = { state: "succeeded", data: { orderId: "ORDER-9" } };
    await act(async () => {
      rerender(<CardPaymentSection {...base} onApprove={fresh} />);
    });

    await waitFor(() => expect(fresh).toHaveBeenCalledWith({ orderId: "ORDER-9" }));
    expect(stale).not.toHaveBeenCalled();
  });

  test("surfaces a failed submission without calling onApprove", async () => {
    const p = props();
    render(<CardPaymentSection {...p} />);
    setValidity({ number: VALID, expiry: VALID, cvv: VALID });

    session.submitResponse = { state: "failed", data: { message: "Card declined." } };
    await act(async () => {
      setValidity({ number: VALID });
    });

    await waitFor(() => expect(screen.getByText("Card declined.")).toBeInTheDocument());
    expect(p.onApprove).not.toHaveBeenCalled();
    expect(p.onError).toHaveBeenCalledWith("Card declined.");
  });
});

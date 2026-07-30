/**
 * PayPal Payouts helpers.
 * Uses the SuperHeroCPR business PayPal REST app to send instructor payouts.
 * Server-side only; never import this from client components.
 */

import { getPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";

/** A payout item ready to send to PayPal. */
export interface PayPalPayoutRecipient {
  /** Internal payout item UUID, sent to PayPal as sender_item_id. */
  id: string;
  /** PayPal email address receiving the payout. */
  recipientEmail: string;
  /** Amount to send in USD. */
  amount: number;
  /** Human-readable note shown to the recipient. */
  note: string;
}

/** Response from PayPal after creating a payout batch. */
export interface PayPalPayoutCreateResult {
  /** PayPal payout batch id, if PayPal accepted the batch. */
  payoutBatchId: string;
  /** PayPal batch status, usually PENDING immediately after creation. */
  batchStatus: string;
  /** Item ids returned by PayPal, keyed by our sender_item_id. */
  itemIdsBySenderItemId: Record<string, string>;
}

/** A normalized PayPal payout item status from batch lookup. */
export interface PayPalPayoutItemStatus {
  /** Internal sender item id originally sent to PayPal. */
  senderItemId: string;
  /** PayPal payout item id. */
  payoutItemId: string | null;
  /** PayPal transaction status for the item. */
  transactionStatus: string;
  /** Optional failure/error message returned by PayPal. */
  errorMessage: string | null;
  /** Fee PayPal charged to send this item, or null when not reported. */
  feeAmount: number | null;
  /** ISO timestamp PayPal processed the item, or null when not reported. */
  timeProcessed: string | null;
}

/** Response from fetching a PayPal payout batch. */
export interface PayPalPayoutBatchStatus {
  /** Current PayPal batch status. */
  batchStatus: string;
  /** Total fee PayPal charged for the batch, or null when not reported. */
  feeTotal: number | null;
  /** Current status for each item PayPal returned. */
  items: PayPalPayoutItemStatus[];
}

/** Error thrown when PayPal returns a non-2xx payout creation response. */
export class PayPalPayoutRequestError extends Error {
  /** HTTP status returned by PayPal. */
  status: number;
  /** Whether PayPal clearly rejected the request before any payout could be created. */
  safeToReleaseReservation: boolean;

  /**
   * Creates a typed PayPal payout error for route-level recovery decisions.
   * @param status - HTTP status returned by PayPal.
   * @param body - Error response body returned by PayPal.
   */
  constructor(status: number, body: string) {
    const trimmedBody = body.slice(0, 1000);
    super(`PayPal payout failed (${status}): ${trimmedBody}`);
    this.name = "PayPalPayoutRequestError";
    this.status = status;
    this.safeToReleaseReservation = status >= 400 && status < 500 && status !== 409;
  }
}

/** Shape of PayPal's create payout response used by this app. */
interface PayPalCreatePayoutResponse {
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: string;
  };
  items?: Array<{
    payout_item_id?: string;
    payout_item?: {
      sender_item_id?: string;
    };
  }>;
}

/** Shape of PayPal's get payout batch response used by this app. */
interface PayPalGetPayoutResponse {
  batch_header?: {
    batch_status?: string;
    fees?: { value?: string };
  };
  items?: Array<{
    payout_item_id?: string;
    transaction_status?: string;
    time_processed?: string;
    payout_item_fee?: { value?: string };
    errors?: {
      name?: string;
      message?: string;
    };
    payout_item?: {
      sender_item_id?: string;
    };
  }>;
}

/** Reads a PayPal `{ value: "1.00" }` money object into a number, or null. */
function parsePayoutMoney(money: { value?: string } | undefined): number | null {
  if (!money || typeof money.value !== "string") return null;
  const parsed = Number.parseFloat(money.value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Creates a PayPal payout batch for grouped instructor payouts.
 * Side effects: sends money from the business PayPal account when PayPal accepts the request.
 * @param senderBatchId - Unique idempotency id for this payout batch.
 * @param recipients - Instructor payout items to send.
 * @returns Normalized PayPal batch id, status, and item id mapping.
 * @throws Error when PayPal rejects the payout request.
 */
export async function createPayPalPayoutBatch(
  senderBatchId: string,
  recipients: PayPalPayoutRecipient[]
): Promise<PayPalPayoutCreateResult> {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalApiBase()}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: "Your SuperHeroCPR instructor payout is on the way",
        email_message:
          "SuperHeroCPR has sent your instructor payout through PayPal.",
      },
      items: recipients.map((recipient) => ({
        recipient_type: "EMAIL",
        amount: {
          value: recipient.amount.toFixed(2),
          currency: "USD",
        },
        receiver: recipient.recipientEmail,
        note: recipient.note,
        sender_item_id: recipient.id,
      })),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new PayPalPayoutRequestError(response.status, errorText);
  }

  const data = (await response.json()) as PayPalCreatePayoutResponse;
  const payoutBatchId = data.batch_header?.payout_batch_id;
  if (!payoutBatchId) {
    throw new Error("PayPal payout response did not include payout_batch_id.");
  }

  const itemIdsBySenderItemId: Record<string, string> = {};
  for (const item of data.items ?? []) {
    const senderItemId = item.payout_item?.sender_item_id;
    const payoutItemId = item.payout_item_id;
    if (senderItemId && payoutItemId) {
      itemIdsBySenderItemId[senderItemId] = payoutItemId;
    }
  }

  return {
    payoutBatchId,
    batchStatus: data.batch_header?.batch_status ?? "PENDING",
    itemIdsBySenderItemId,
  };
}

/**
 * Fetches the current PayPal status for a payout batch.
 * @param payoutBatchId - PayPal payout batch id returned by createPayPalPayoutBatch.
 * @returns Normalized batch and item statuses.
 * @throws Error when PayPal rejects the status lookup.
 */
export async function getPayPalPayoutBatchStatus(
  payoutBatchId: string
): Promise<PayPalPayoutBatchStatus> {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(
    `${getPayPalApiBase()}/v1/payments/payouts/${payoutBatchId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`PayPal payout status failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as PayPalGetPayoutResponse;
  return {
    batchStatus: data.batch_header?.batch_status ?? "UNKNOWN",
    feeTotal: parsePayoutMoney(data.batch_header?.fees),
    items: (data.items ?? [])
      .map((item) => ({
        senderItemId: item.payout_item?.sender_item_id ?? "",
        payoutItemId: item.payout_item_id ?? null,
        transactionStatus: item.transaction_status ?? "UNKNOWN",
        errorMessage: item.errors?.message ?? item.errors?.name ?? null,
        feeAmount: parsePayoutMoney(item.payout_item_fee),
        timeProcessed: item.time_processed ?? null,
      }))
      .filter((item) => item.senderItemId.length > 0),
  };
}

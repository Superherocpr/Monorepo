/**
 * lib/send-email.ts
 * The single way this app sends mail. Every Resend call goes through `sendEmail`.
 *
 * WHY THIS EXISTS
 *   Before this module, ~35 call sites each did `new Resend(process.env.RESEND_API_KEY)`
 *   and `from: process.env.RESEND_FROM_EMAIL!` by hand. Three problems followed from
 *   that, and all three were live in production:
 *
 *   1. `RESEND_FROM_EMAIL` was asserted non-null (`!`) at nearly every call site but
 *      checked at only two. If that variable were ever dropped from the Amplify
 *      environment, every email in the system would fail at the API layer with no
 *      single place to notice it.
 *
 *   2. The Resend SDK RESOLVES on API-level failures — it returns
 *      `{ data: null, error: ErrorResponse }` rather than rejecting. Call sites that
 *      only attached `.catch()` therefore swallowed every rejected send: bad address,
 *      quota exceeded, invalid key. `.catch()` sees network throws only.
 *
 *   3. Two call sites (customer creation, welcome email) had no error handling at all,
 *      so a failed account-setup email produced no log line anywhere.
 *
 *   Centralising also buys retries. A Resend 5xx or a rate-limit response used to
 *   permanently drop a booking confirmation; now it is retried with backoff under a
 *   stable idempotency key, so a retry cannot deliver the same mail twice.
 *
 * CONTRACT
 *   `sendEmail` NEVER throws and never rejects. It always resolves to a
 *   `SendEmailResult`. Callers that treat mail as best-effort can ignore the result
 *   entirely and still get a logged failure; callers that need to react (an admin
 *   clicking "resend invite") can branch on `result.sent`.
 *
 * Server-side only — never import from a client component.
 */

import { Resend } from "resend";

/** A file attached to an outgoing email. Mirrors the subset of Resend's shape we use. */
export interface EmailAttachment {
  /** Filename shown to the recipient, e.g. "roster-template.csv". */
  filename: string;
  /** File bytes. */
  content: Buffer | string;
}

/** Everything `sendEmail` needs to deliver one message. */
export interface SendEmailParams {
  /** Recipient address, or several. Empty/blank entries are dropped. */
  to: string | string[];
  subject: string;
  html: string;
  /**
   * Log label identifying the call site, e.g. "bookings/confirm:customer".
   * Every log line this module emits is prefixed `[email:<context>]`, so a grep of
   * CloudWatch for `[email:` returns the full mail history of a deploy.
   */
  context: string;
  attachments?: EmailAttachment[];
  /** Overrides the `RESEND_FROM_EMAIL` default. Rarely needed. */
  from?: string;
  /** Address replies should go to, when it differs from `from`. */
  replyTo?: string;
  /**
   * Stable key that makes a retry safe. Defaults to a random key generated per call,
   * which is enough to dedupe this module's OWN retries. Pass an explicit key derived
   * from the triggering entity (e.g. `booking-confirm-${bookingId}`) when the CALLER
   * may also be retried — a PayPal webhook redelivery, say — and the recipient must
   * not receive the mail twice.
   */
  idempotencyKey?: string;
}

/** Outcome of a send. Discriminated on `sent`. */
export type SendEmailResult =
  | { sent: true; id: string | null }
  | {
      sent: false;
      /**
       * `not_configured` — Resend env vars absent; expected in local dev and never an alert.
       * `no_recipient`   — caller passed no usable address; a caller bug worth seeing.
       * `failed`         — Resend was called and rejected the message, or the network did.
       */
      reason: "not_configured" | "no_recipient" | "failed";
      /** Human-readable failure detail for logs. Never surfaced to end users. */
      error: string | null;
    };

/** Total attempts per send: the first try plus two retries. */
const MAX_ATTEMPTS = 3;

/** Base backoff in ms; attempt N waits BASE * 3^(N-1) — 300ms, then 900ms. */
const RETRY_BASE_MS = 300;

/**
 * Resend error codes that represent a transient condition rather than a bad message.
 * Retrying a `validation_error` or an `invalid_from_address` would fail identically
 * every time and only delay the log line, so those are excluded deliberately.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "rate_limit_exceeded",
  "internal_server_error",
  "application_error",
]);

/** Shape of the SDK's resolved error. Declared locally to avoid importing an internal type. */
interface ResendErrorLike {
  message: string;
  statusCode: number | null;
  name: string;
}

/**
 * Cached client, plus the key it was built from.
 *
 * The client is a thin wrapper over fetch and holds no connection state, but a
 * fan-out (one email per student in a class) would otherwise allocate one per
 * message. Keyed on the API key so a changed environment still rebuilds it.
 */
let cachedClient: { key: string; client: Resend } | null = null;

/**
 * Returns the Resend client for the given API key, building it on first use.
 * @param apiKey - The key the client should authenticate with.
 * @returns A client bound to that key.
 */
function getClient(apiKey: string): Resend {
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new Resend(apiKey) };
  }
  return cachedClient.client;
}

/**
 * Decides whether a failed attempt is worth repeating.
 *
 * @param error - The error object the SDK resolved with.
 * @returns true when the same request could plausibly succeed on a later attempt.
 */
function isRetryable(error: ResendErrorLike): boolean {
  if (RETRYABLE_ERROR_NAMES.has(error.name)) return true;
  // 429 and any 5xx are transient regardless of the code Resend attaches.
  if (error.statusCode !== null && (error.statusCode === 429 || error.statusCode >= 500)) {
    return true;
  }
  return false;
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalises `to` into a list of non-blank addresses.
 *
 * Callers frequently build recipient lists from database rows where `email` is
 * nullable, so filtering blanks here prevents a single null from failing the
 * whole send with an opaque validation error.
 *
 * @param to - One address or several.
 * @returns Trimmed, non-empty addresses.
 */
function normaliseRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  return list.filter((address): address is string => typeof address === "string" && address.trim() !== "").map((address) => address.trim());
}

/**
 * Sends one transactional email through Resend, with env guards, error inspection,
 * retry-with-backoff on transient failures, and structured logging.
 *
 * Never throws. See the module header for why every send must go through here.
 *
 * Side effects: one or more HTTPS calls to the Resend API; writes log lines via
 * console.warn / console.error.
 *
 * @param params - Recipients, content, and the log context for this send.
 * @returns The send outcome; `{ sent: false }` variants carry a machine-readable reason.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { context } = params;
  const apiKey = process.env.RESEND_API_KEY;
  const from = params.from ?? process.env.RESEND_FROM_EMAIL;

  // Guard BOTH variables. Checking only the API key was the original bug: a missing
  // RESEND_FROM_EMAIL sailed past every guard and failed later at the API.
  if (!apiKey || !from) {
    const missing = [!apiKey && "RESEND_API_KEY", !from && "RESEND_FROM_EMAIL"]
      .filter(Boolean)
      .join(", ");
    console.warn(`[email:${context}] Resend not configured (missing ${missing}) — skipping send.`);
    return { sent: false, reason: "not_configured", error: `missing ${missing}` };
  }

  const recipients = normaliseRecipients(params.to);
  if (recipients.length === 0) {
    console.error(`[email:${context}] No valid recipient address — skipping send.`);
    return { sent: false, reason: "no_recipient", error: "no valid recipient" };
  }

  const resend = getClient(apiKey);

  // One key for the whole call, reused across retries, so a retry after a network
  // throw (where the first attempt may in fact have been delivered) cannot produce
  // a duplicate email.
  const idempotencyKey = params.idempotencyKey ?? `${context}-${crypto.randomUUID()}`;

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await resend.emails.send(
        {
          from,
          to: recipients,
          subject: params.subject,
          html: params.html,
          ...(params.replyTo ? { replyTo: params.replyTo } : {}),
          ...(params.attachments?.length ? { attachments: params.attachments } : {}),
        },
        { idempotencyKey }
      );

      // The SDK RESOLVES on API errors — this branch, not a catch, is where a
      // rejected message actually surfaces.
      if (result.error) {
        const error = result.error as ResendErrorLike;
        lastError = `${error.name}: ${error.message}`;

        if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
          console.warn(
            `[email:${context}] Attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError}) — retrying.`
          );
          await delay(RETRY_BASE_MS * 3 ** (attempt - 1));
          continue;
        }

        console.error(`[email:${context}] Send failed after ${attempt} attempt(s): ${lastError}`);
        return { sent: false, reason: "failed", error: lastError };
      }

      return { sent: true, id: result.data?.id ?? null };
    } catch (err) {
      // A genuine throw: DNS, TLS, socket, or an SDK bug. Always transient-ish,
      // so it is retried until the attempt budget runs out.
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[email:${context}] Attempt ${attempt}/${MAX_ATTEMPTS} threw (${lastError}) — retrying.`
        );
        await delay(RETRY_BASE_MS * 3 ** (attempt - 1));
        continue;
      }

      console.error(`[email:${context}] Send threw after ${attempt} attempt(s): ${lastError}`);
      return { sent: false, reason: "failed", error: lastError };
    }
  }

  // Unreachable: the loop returns on every path. Present so the function is
  // total for TypeScript without an assertion.
  return { sent: false, reason: "failed", error: lastError };
}

/**
 * Sends several emails concurrently and reports how many landed.
 *
 * Used by fan-out call sites (notify every instructor, every admin) that previously
 * built their own `Promise.all` and inspected each result by hand. Individual
 * failures are logged by `sendEmail` itself and never reject this call.
 *
 * Side effects: one Resend API call per entry.
 *
 * @param emails - One `SendEmailParams` per message.
 * @returns Counts of successful and failed sends.
 */
export async function sendEmails(
  emails: SendEmailParams[]
): Promise<{ sent: number; failed: number; results: SendEmailResult[] }> {
  const results = await Promise.all(emails.map((email) => sendEmail(email)));
  const sent = results.filter((result) => result.sent).length;
  return { sent, failed: results.length - sent, results };
}

/**
 * Reports whether Resend is fully configured in this environment.
 *
 * Lets a caller skip expensive preparation (database reads, template rendering,
 * CSV generation) when no mail could be sent anyway. It is NOT required before
 * calling `sendEmail` — that function guards itself.
 *
 * @returns true when both Resend env vars are present.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

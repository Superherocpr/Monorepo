/**
 * Unit tests for lib/send-email.ts.
 *
 * This module is the single delivery path for every transactional email in the
 * app, so the properties locked in here are the ones whose regression would
 * silently stop mail reaching customers:
 *
 *   1. A missing RESEND_FROM_EMAIL must be caught by the guard, not sent to the
 *      API as `undefined`. This was the original production risk: the variable
 *      was asserted non-null at ~35 call sites and checked at two.
 *   2. The Resend SDK RESOLVES on API errors rather than rejecting. A send that
 *      comes back `{ error }` must be reported as failed — a `.catch()`-shaped
 *      implementation would call it a success and log nothing.
 *   3. Transient failures (429, 5xx) must be retried; permanent ones (validation)
 *      must NOT be, or a bad address burns three API calls per send.
 *   4. Retries must reuse ONE idempotency key, or a retry after a network throw
 *      delivers the customer a second copy of the same email.
 *   5. sendEmail must never throw, whatever the SDK does — every caller treats it
 *      as best-effort and an exception would abort a committed booking or payment.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

/** Captures the args of every `resend.emails.send` call across a test. */
const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

/** A resolved Resend error, the shape the SDK returns instead of rejecting. */
function resendError(name: string, statusCode: number | null, message = "boom") {
  return { data: null, error: { name, statusCode, message } };
}

/** A resolved Resend success. */
function resendOk(id = "email_123") {
  return { data: { id }, error: null };
}

/** Imports the module fresh so it re-reads process.env at call time. */
async function importModule() {
  return await import("@/lib/send-email");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "SuperHeroCPR <noreply@example.com>";
  // Retries use real timers with short backoffs (300ms, 900ms); faking them here
  // keeps the retry tests instant without changing the module's behaviour.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

/** Standard params so each test only states what it is actually varying. */
const BASE = {
  context: "test",
  to: "customer@example.com",
  subject: "Subject",
  html: "<p>Body</p>",
};

describe("environment guards", () => {
  test("refuses to send when RESEND_FROM_EMAIL is missing", async () => {
    delete process.env.RESEND_FROM_EMAIL;
    const { sendEmail } = await importModule();

    const result = await sendEmail(BASE);

    expect(result).toEqual({
      sent: false,
      reason: "not_configured",
      error: "missing RESEND_FROM_EMAIL",
    });
    // The whole point: the API is never called with an undefined `from`.
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("refuses to send when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    const { sendEmail } = await importModule();

    const result = await sendEmail(BASE);

    expect(result).toEqual({
      sent: false,
      reason: "not_configured",
      error: "missing RESEND_API_KEY",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("names both variables when both are missing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    const { sendEmail } = await importModule();

    const result = await sendEmail(BASE);

    expect(result.sent).toBe(false);
    expect(result.sent === false && result.error).toBe(
      "missing RESEND_API_KEY, RESEND_FROM_EMAIL"
    );
  });

  test("isEmailConfigured requires BOTH variables", async () => {
    const { isEmailConfigured } = await importModule();
    expect(isEmailConfigured()).toBe(true);

    delete process.env.RESEND_FROM_EMAIL;
    expect(isEmailConfigured()).toBe(false);

    process.env.RESEND_FROM_EMAIL = "a@b.com";
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("recipient handling", () => {
  test("reports no_recipient rather than calling the API with an empty address", async () => {
    const { sendEmail } = await importModule();

    const result = await sendEmail({ ...BASE, to: "   " });

    expect(result).toEqual({
      sent: false,
      reason: "no_recipient",
      error: "no valid recipient",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("drops blank entries from a recipient list", async () => {
    sendMock.mockResolvedValue(resendOk());
    const { sendEmail } = await importModule();

    await sendEmail({ ...BASE, to: ["a@example.com", "", "  b@example.com  "] });

    expect(sendMock.mock.calls[0][0].to).toEqual(["a@example.com", "b@example.com"]);
  });

  test("reports no_recipient when a list contains only blanks", async () => {
    const { sendEmail } = await importModule();

    const result = await sendEmail({ ...BASE, to: ["", "   "] });

    expect(result.sent).toBe(false);
    expect(result.sent === false && result.reason).toBe("no_recipient");
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("SDK error semantics", () => {
  test("treats a RESOLVED error response as a failure, not a success", async () => {
    // This is the bug the whole module exists to prevent: the SDK resolves here,
    // so a .catch()-only implementation would report this send as delivered.
    sendMock.mockResolvedValue(resendError("validation_error", 422, "bad address"));
    const { sendEmail } = await importModule();

    const result = await sendEmail(BASE);

    expect(result.sent).toBe(false);
    expect(result.sent === false && result.reason).toBe("failed");
    expect(result.sent === false && result.error).toContain("validation_error");
  });

  test("returns the message id on success", async () => {
    sendMock.mockResolvedValue(resendOk("email_abc"));
    const { sendEmail } = await importModule();

    const result = await sendEmail(BASE);

    expect(result).toEqual({ sent: true, id: "email_abc" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("never throws when the SDK rejects", async () => {
    sendMock.mockRejectedValue(new Error("socket hang up"));
    const { sendEmail } = await importModule();

    // Must resolve, not reject — callers rely on this to protect committed work.
    const result = await sendEmail(BASE);

    expect(result.sent).toBe(false);
    expect(result.sent === false && result.error).toBe("socket hang up");
  });
});

describe("retry policy", () => {
  test("retries a 429 and succeeds on a later attempt", async () => {
    sendMock
      .mockResolvedValueOnce(resendError("rate_limit_exceeded", 429))
      .mockResolvedValueOnce(resendOk("email_retry"));
    const { sendEmail } = await importModule();

    const promise = sendEmail(BASE);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ sent: true, id: "email_retry" });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test("retries a 5xx up to three attempts, then gives up", async () => {
    sendMock.mockResolvedValue(resendError("internal_server_error", 500));
    const { sendEmail } = await importModule();

    const promise = sendEmail(BASE);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.sent).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  test("does NOT retry a validation error", async () => {
    sendMock.mockResolvedValue(resendError("validation_error", 422));
    const { sendEmail } = await importModule();

    const promise = sendEmail(BASE);
    await vi.runAllTimersAsync();
    await promise;

    // Retrying a malformed message would fail identically three times over.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("does NOT retry an invalid API key", async () => {
    sendMock.mockResolvedValue(resendError("invalid_api_key", 401));
    const { sendEmail } = await importModule();

    const promise = sendEmail(BASE);
    await vi.runAllTimersAsync();
    await promise;

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("retries a thrown network error", async () => {
    sendMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(resendOk());
    const { sendEmail } = await importModule();

    const promise = sendEmail(BASE);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.sent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe("idempotency", () => {
  test("reuses one key across retries so a retry cannot duplicate the email", async () => {
    sendMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(resendOk());
    const { sendEmail } = await importModule();

    const promise = sendEmail({ ...BASE, idempotencyKey: "booking-42" });
    await vi.runAllTimersAsync();
    await promise;

    // A network throw may mean the first attempt WAS delivered; the shared key is
    // what stops the retry sending a second copy.
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: "booking-42" });
    expect(sendMock.mock.calls[1][1]).toEqual({ idempotencyKey: "booking-42" });
  });

  test("generates a key when the caller does not supply one", async () => {
    sendMock.mockResolvedValue(resendOk());
    const { sendEmail } = await importModule();

    await sendEmail(BASE);

    const key = sendMock.mock.calls[0][1].idempotencyKey;
    expect(typeof key).toBe("string");
    expect(key.startsWith("test-")).toBe(true);
  });
});

describe("payload construction", () => {
  test("uses RESEND_FROM_EMAIL and omits optional fields when unset", async () => {
    sendMock.mockResolvedValue(resendOk());
    const { sendEmail } = await importModule();

    await sendEmail(BASE);

    const payload = sendMock.mock.calls[0][0];
    expect(payload.from).toBe("SuperHeroCPR <noreply@example.com>");
    expect(payload.subject).toBe("Subject");
    expect(payload).not.toHaveProperty("replyTo");
    expect(payload).not.toHaveProperty("attachments");
  });

  test("passes replyTo and attachments through when supplied", async () => {
    sendMock.mockResolvedValue(resendOk());
    const { sendEmail } = await importModule();

    await sendEmail({
      ...BASE,
      replyTo: "visitor@example.com",
      attachments: [{ filename: "roster.csv", content: "a,b,c" }],
    });

    const payload = sendMock.mock.calls[0][0];
    expect(payload.replyTo).toBe("visitor@example.com");
    expect(payload.attachments).toEqual([{ filename: "roster.csv", content: "a,b,c" }]);
  });

  test("an explicit from overrides the environment default", async () => {
    sendMock.mockResolvedValue(resendOk());
    const { sendEmail } = await importModule();

    await sendEmail({ ...BASE, from: "Other <other@example.com>" });

    expect(sendMock.mock.calls[0][0].from).toBe("Other <other@example.com>");
  });
});

describe("sendEmails fan-out", () => {
  test("counts successes and failures independently", async () => {
    sendMock
      .mockResolvedValueOnce(resendOk())
      .mockResolvedValueOnce(resendError("validation_error", 422))
      .mockResolvedValueOnce(resendOk());
    const { sendEmails } = await importModule();

    const promise = sendEmails([
      { ...BASE, to: "a@example.com" },
      { ...BASE, to: "b@example.com" },
      { ...BASE, to: "c@example.com" },
    ]);
    await vi.runAllTimersAsync();
    const { sent, failed, results } = await promise;

    // One bad address must not cost the other recipients their email.
    expect(sent).toBe(2);
    expect(failed).toBe(1);
    expect(results).toHaveLength(3);
  });

  test("returns zero counts for an empty list without calling the API", async () => {
    const { sendEmails } = await importModule();

    const { sent, failed } = await sendEmails([]);

    expect(sent).toBe(0);
    expect(failed).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

/**
 * Unit tests for computeSpotsRemaining in lib/class-availability.ts
 *
 * This arithmetic decides whether a class looks bookable on /book and whether
 * /find-a-class sends someone to the schedule or to a request. The subtle rule
 * is that invoiced students hold seats before anyone pays, so getting it wrong
 * overbooks a class that a company has already reserved.
 */
import { describe, test, expect } from "vitest";
import { computeSpotsRemaining } from "@/lib/class-availability";

describe("computeSpotsRemaining", () => {
  test("an empty session has every seat", () => {
    expect(computeSpotsRemaining(10, [], [])).toBe(10);
  });

  test("active bookings take a seat each", () => {
    const bookings = [{ cancelled: false }, { cancelled: false }];
    expect(computeSpotsRemaining(10, bookings, [])).toBe(8);
  });

  test("cancelled bookings give their seat back", () => {
    const bookings = [{ cancelled: false }, { cancelled: true }];
    expect(computeSpotsRemaining(10, bookings, [])).toBe(9);
  });

  test("invoiced students hold seats even when the invoice is unpaid", () => {
    const invoices = [{ student_count: 4, status: "sent" }];
    expect(computeSpotsRemaining(10, [], invoices)).toBe(6);
  });

  test("cancelled invoices release their seats", () => {
    const invoices = [
      { student_count: 4, status: "cancelled" },
      { student_count: 2, status: "paid" },
    ];
    expect(computeSpotsRemaining(10, [], invoices)).toBe(8);
  });

  test("bookings and invoices both count against the same capacity", () => {
    const bookings = [{ cancelled: false }, { cancelled: false }];
    const invoices = [{ student_count: 3, status: "sent" }];
    expect(computeSpotsRemaining(10, bookings, invoices)).toBe(5);
  });

  test("an oversubscribed session reports zero, never a negative", () => {
    const invoices = [{ student_count: 25, status: "paid" }];
    expect(computeSpotsRemaining(10, [], invoices)).toBe(0);
  });

  test("a session filled exactly to capacity reports zero", () => {
    const bookings = Array.from({ length: 6 }, () => ({ cancelled: false }));
    expect(computeSpotsRemaining(6, bookings, [])).toBe(0);
  });
});

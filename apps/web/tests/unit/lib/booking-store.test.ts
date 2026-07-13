/**
 * Unit tests for lib/booking-store.ts
 *
 * Covers: getBookingStore, setBookingStore, clearBookingStore.
 * sessionStorage is provided by jsdom. The global afterEach in setup.ts clears
 * storage between tests so state cannot bleed across test cases.
 */
import { describe, test, expect } from "vitest";
import {
  getBookingStore,
  setBookingStore,
  clearBookingStore,
  type BookingStore,
} from "@/lib/booking-store";

describe("getBookingStore", () => {
  test("returns an empty store when sessionStorage has no data", () => {
    const store = getBookingStore();
    expect(store.sessionId).toBeNull();
    expect(store.sessionDetails).toBeNull();
    expect(store.customerDetails).toBeNull();
    expect(store.isNewCustomer).toBe(false);
    expect(store.customerId).toBeNull();
  });

  test("returns the same shape on repeated calls when storage is empty", () => {
    const a = getBookingStore();
    const b = getBookingStore();
    expect(a).toEqual(b);
  });
});

describe("setBookingStore", () => {
  test("persists a sessionId and reads it back", () => {
    setBookingStore({ sessionId: "abc-123" });
    expect(getBookingStore().sessionId).toBe("abc-123");
  });

  test("merges partial updates without overwriting unrelated fields", () => {
    setBookingStore({ sessionId: "s1" });
    setBookingStore({ customerId: "u1" });
    const store = getBookingStore();
    expect(store.sessionId).toBe("s1");
    expect(store.customerId).toBe("u1");
  });

  test("overwrites a previously stored value", () => {
    setBookingStore({ sessionId: "old" });
    setBookingStore({ sessionId: "new" });
    expect(getBookingStore().sessionId).toBe("new");
  });

  test("persists full sessionDetails", () => {
    const details: BookingStore["sessionDetails"] = {
      className: "BLS Provider",
      instructorName: "Jane Doe",
      instructorEmail: "jane@example.com",
      instructorPhone: null,
      startsAt: "2026-06-01T09:00:00Z",
      endsAt: "2026-06-01T13:00:00Z",
      locationName: "Tampa HQ",
      locationAddress: "1 Hero Way",
      locationCity: "Tampa",
      locationState: "FL",
      locationZip: "33601",
      price: 75,
      spotsRemaining: 10,
    };
    setBookingStore({ sessionDetails: details });
    expect(getBookingStore().sessionDetails).toEqual(details);
  });

  test("persists customerDetails", () => {
    const customer: BookingStore["customerDetails"] = {
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      phone: "555-1234",
      address: "1 Main St",
      city: "Tampa",
      state: "FL",
      zip: "33601",
    };
    setBookingStore({ customerDetails: customer });
    expect(getBookingStore().customerDetails).toEqual(customer);
  });
});

describe("clearBookingStore", () => {
  test("removes all stored data", () => {
    setBookingStore({ sessionId: "abc", customerId: "user-1" });
    clearBookingStore();
    const store = getBookingStore();
    expect(store.sessionId).toBeNull();
    expect(store.customerId).toBeNull();
  });

  test("is safe to call when nothing is stored", () => {
    expect(() => clearBookingStore()).not.toThrow();
  });
});

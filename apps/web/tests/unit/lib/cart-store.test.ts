/**
 * Unit tests for lib/cart-store.ts
 *
 * Covers: getCart, setCart, clearCart.
 * localStorage is provided by jsdom. The global afterEach in setup.ts clears
 * storage between tests.
 */
import { describe, test, expect } from "vitest";
import { getCart, setCart, clearCart, type CartItem } from "@/lib/cart-store";

/** Minimal CartItem fixture used across multiple tests. */
const ITEM_A: CartItem = {
  variantId: "v-1",
  productId: "p-1",
  productName: "Hero T-Shirt",
  productImage: null,
  size: "M",
  price: 25,
  quantity: 1,
};

const ITEM_B: CartItem = {
  variantId: "v-2",
  productId: "p-2",
  productName: "Hero Hoodie",
  productImage: "/hoodie.png",
  size: "L",
  price: 45,
  quantity: 2,
};

describe("getCart", () => {
  test("returns an empty array when localStorage has no cart data", () => {
    expect(getCart()).toEqual([]);
  });
});

describe("setCart", () => {
  test("stores a single item and reads it back", () => {
    setCart([ITEM_A]);
    expect(getCart()).toEqual([ITEM_A]);
  });

  test("stores multiple items", () => {
    setCart([ITEM_A, ITEM_B]);
    const cart = getCart();
    expect(cart).toHaveLength(2);
    expect(cart[0]).toEqual(ITEM_A);
    expect(cart[1]).toEqual(ITEM_B);
  });

  test("overwrites a previous cart state", () => {
    setCart([ITEM_A]);
    setCart([ITEM_B]);
    const cart = getCart();
    expect(cart).toHaveLength(1);
    expect(cart[0]).toEqual(ITEM_B);
  });

  test("can store an empty cart (clears items without removing the key)", () => {
    setCart([ITEM_A]);
    setCart([]);
    expect(getCart()).toEqual([]);
  });
});

describe("clearCart", () => {
  test("removes the cart key from localStorage", () => {
    setCart([ITEM_A]);
    clearCart();
    expect(getCart()).toEqual([]);
  });

  test("is safe to call when no cart is stored", () => {
    expect(() => clearCart()).not.toThrow();
  });

  test("allows a fresh cart to be set after clearing", () => {
    setCart([ITEM_A]);
    clearCart();
    setCart([ITEM_B]);
    expect(getCart()[0]).toEqual(ITEM_B);
  });
});

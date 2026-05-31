/**
 * Unit tests for components/ui/Button.tsx
 *
 * Covers: renders correctly, variant class application, size class application,
 * disabled state styling and behavior, and click handler forwarding.
 */
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  test("renders children as button text", () => {
    render(<Button>Book Now</Button>);
    expect(screen.getByRole("button", { name: "Book Now" })).toBeInTheDocument();
  });

  test("uses primary variant by default", () => {
    render(<Button>Click</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-red-600");
  });

  test("applies secondary variant classes", () => {
    render(<Button variant="secondary">Click</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("border-red-600");
  });

  test("applies destructive variant classes", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-red-100");
  });

  test("applies sm size classes", () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button").className).toContain("px-4");
  });

  test("applies lg size classes", () => {
    render(<Button size="lg">Large</Button>);
    expect(screen.getByRole("button").className).toContain("px-8");
  });

  test("is disabled when disabled prop is passed", () => {
    render(<Button disabled>Submit</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  test("applies opacity and cursor styles when disabled", () => {
    render(<Button disabled>Submit</Button>);
    expect(screen.getByRole("button").className).toContain("opacity-50");
  });

  test("calls onClick handler when clicked", async () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Click me</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(handler).toHaveBeenCalledOnce();
  });

  test("does not fire onClick when disabled", async () => {
    const handler = vi.fn();
    render(<Button disabled onClick={handler}>Click me</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(handler).not.toHaveBeenCalled();
  });

  test("merges additional className", () => {
    render(<Button className="mt-4">Click</Button>);
    expect(screen.getByRole("button").className).toContain("mt-4");
  });

  test("renders with type='submit' when specified", () => {
    render(<Button type="submit">Submit Form</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});

/**
 * Unit tests for components/ui/Input.tsx
 *
 * Covers: renders label and input, label/input association via htmlFor/id,
 * error message display and red border classes, disabled state styling,
 * value forwarding, and extra className merging.
 */
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/Input";

describe("Input", () => {
  test("renders a visible label", () => {
    render(<Input label="Email" />);
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  test("renders an input element", () => {
    render(<Input label="Email" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  test("associates the label with the input via htmlFor/id", () => {
    render(<Input label="Email" />);
    const label = screen.getByText("Email");
    const input = screen.getByRole("textbox");
    // The label's htmlFor must match the input's id
    expect(label).toHaveAttribute("for", input.id);
  });

  test("shows an error message when error prop is provided", () => {
    render(<Input label="Email" error="Invalid email address" />);
    expect(screen.getByText("Invalid email address")).toBeInTheDocument();
  });

  test("applies red border class when in error state", () => {
    render(<Input label="Email" error="Required" />);
    expect(screen.getByRole("textbox").className).toContain("border-red-500");
  });

  test("does not show an error paragraph when error prop is absent", () => {
    render(<Input label="Email" />);
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
  });

  test("is disabled when disabled prop is passed", () => {
    render(<Input label="Email" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  test("applies disabled background classes when disabled", () => {
    render(<Input label="Email" disabled />);
    expect(screen.getByRole("textbox").className).toContain("cursor-not-allowed");
  });

  test("forwards the type prop to the underlying input", () => {
    render(<Input label="Password" type="password" />);
    // Passwords don't appear as textbox role — query by label text
    const input = document.querySelector("input[type='password']");
    expect(input).not.toBeNull();
  });

  test("forwards the placeholder prop", () => {
    render(<Input label="Email" placeholder="you@example.com" />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });

  test("calls onChange when the user types", async () => {
    const handler = vi.fn();
    render(<Input label="Name" onChange={handler} />);
    await userEvent.type(screen.getByRole("textbox"), "Alice");
    expect(handler).toHaveBeenCalled();
  });

  test("merges extra className onto the input element", () => {
    render(<Input label="Email" className="w-full" />);
    expect(screen.getByRole("textbox").className).toContain("w-full");
  });

  test("assigns unique ids when multiple instances render on the same page", () => {
    render(
      <>
        <Input label="First Name" />
        <Input label="Last Name" />
      </>
    );
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0].id).not.toBe(inputs[1].id);
  });
});

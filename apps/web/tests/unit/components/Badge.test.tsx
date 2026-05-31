/**
 * Unit tests for components/ui/Badge.tsx
 *
 * Covers: renders correctly, all five variant class applications,
 * and extra className forwarding.
 */
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/Badge";

describe("Badge", () => {
  test("renders the label text", () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  test("renders as an inline span", () => {
    render(<Badge variant="info">Scheduled</Badge>);
    expect(screen.getByText("Scheduled").tagName).toBe("SPAN");
  });

  test("applies green classes for success variant", () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText("Active").className).toContain("green");
  });

  test("applies amber classes for warning variant", () => {
    render(<Badge variant="warning">Expiring Soon</Badge>);
    expect(screen.getByText("Expiring Soon").className).toContain("amber");
  });

  test("applies red classes for danger variant", () => {
    render(<Badge variant="danger">Expired</Badge>);
    expect(screen.getByText("Expired").className).toContain("red");
  });

  test("applies blue classes for info variant", () => {
    render(<Badge variant="info">Scheduled</Badge>);
    expect(screen.getByText("Scheduled").className).toContain("blue");
  });

  test("applies gray classes for neutral variant", () => {
    render(<Badge variant="neutral">Inactive</Badge>);
    expect(screen.getByText("Inactive").className).toContain("gray");
  });

  test("merges extra className", () => {
    render(<Badge variant="success" className="ml-2">Active</Badge>);
    expect(screen.getByText("Active").className).toContain("ml-2");
  });

  test("renders non-string children", () => {
    render(
      <Badge variant="info">
        <strong>Bold Label</strong>
      </Badge>
    );
    expect(screen.getByText("Bold Label")).toBeInTheDocument();
  });
});

/**
 * Unit tests for components/rollcall/LiveRosterStatus.tsx
 *
 * Covers what the instructor sees: the status text per connection state, the
 * Refresh button always being present and clickable, the button disabling
 * while a refresh is in flight, and the custom label used on the session page.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveRosterStatus from "@/components/rollcall/LiveRosterStatus";

afterEach(cleanup);

describe("LiveRosterStatus", () => {
  test.each([
    ["connected", "Live"],
    ["connecting", "Connecting…"],
    ["disconnected", "Not live. Press Refresh."],
  ] as const)("shows the %s status text", (connection, text) => {
    render(<LiveRosterStatus connection={connection} refreshing={false} onRefresh={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  test("the Refresh button is present even when everything is healthy, and calls onRefresh", async () => {
    const onRefresh = vi.fn();
    render(<LiveRosterStatus connection="connected" refreshing={false} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh check-ins" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("the button is disabled and relabelled while refreshing", () => {
    render(<LiveRosterStatus connection="connected" refreshing={true} onRefresh={() => {}} />);
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  });

  test("uses a custom label when given", () => {
    render(
      <LiveRosterStatus
        connection="connected"
        refreshing={false}
        onRefresh={() => {}}
        label="Refresh roster"
      />
    );
    expect(screen.getByRole("button", { name: "Refresh roster" })).toBeInTheDocument();
  });
});

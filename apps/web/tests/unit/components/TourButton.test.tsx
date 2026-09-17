/**
 * Unit tests for components/tours/TourButton.tsx
 *
 * Covers the component's own logic: starting a Driver.js tour on click,
 * auto-launching once when the URL's `?tour=` param matches the button's
 * `id`, not auto-launching on a non-matching or absent param, and tearing
 * down an in-progress tour on unmount. Driver.js itself (third-party) and
 * next/navigation's useSearchParams are mocked.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const driveMock = vi.fn();
const destroyMock = vi.fn();
const driverFactory = vi.fn((_config?: unknown) => ({ drive: driveMock, destroy: destroyMock }));

vi.mock("driver.js", () => ({
  driver: (config?: unknown) => driverFactory(config),
}));

/** Mutable so each test controls what the URL's search params look like. */
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

import TourButton from "@/components/tours/TourButton";
import type { DriveStep } from "driver.js";

const STEPS: DriveStep[] = [
  { element: "#foo", popover: { title: "Foo", description: "Do the foo." } },
];

beforeEach(() => {
  driveMock.mockClear();
  destroyMock.mockClear();
  driverFactory.mockClear();
  mockSearchParams = new URLSearchParams();
  window.history.replaceState({}, "", "/admin/sessions/new");
});

describe("TourButton", () => {
  test("clicking the button starts a tour with the given steps", async () => {
    const user = userEvent.setup();
    render(<TourButton id="create-session" steps={STEPS} />);

    await user.click(screen.getByRole("button", { name: /need help/i }));

    expect(driverFactory).toHaveBeenCalledTimes(1);
    expect(driverFactory.mock.calls[0][0]).toMatchObject({ steps: STEPS });
    expect(driveMock).toHaveBeenCalledTimes(1);
  });

  test("auto-starts once when the URL's ?tour= param matches id", () => {
    mockSearchParams = new URLSearchParams("tour=create-session");
    window.history.replaceState({}, "", "/admin/sessions/new?tour=create-session");

    render(<TourButton id="create-session" steps={STEPS} />);

    expect(driverFactory).toHaveBeenCalledTimes(1);
    expect(driveMock).toHaveBeenCalledTimes(1);
  });

  test("strips the ?tour= param from the URL after auto-starting", () => {
    mockSearchParams = new URLSearchParams("tour=create-session");
    window.history.replaceState({}, "", "/admin/sessions/new?tour=create-session");

    render(<TourButton id="create-session" steps={STEPS} />);

    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/admin/sessions/new");
  });

  test("does not auto-start when the ?tour= param does not match id", () => {
    mockSearchParams = new URLSearchParams("tour=some-other-tour");

    render(<TourButton id="create-session" steps={STEPS} />);

    expect(driverFactory).not.toHaveBeenCalled();
  });

  test("does not auto-start when there is no ?tour= param", () => {
    render(<TourButton id="create-session" steps={STEPS} />);

    expect(driverFactory).not.toHaveBeenCalled();
  });

  test("destroys an in-progress tour on unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TourButton id="create-session" steps={STEPS} />);

    await user.click(screen.getByRole("button", { name: /need help/i }));
    unmount();

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  test("does not call destroy on unmount when no tour was ever started", () => {
    const { unmount } = render(<TourButton id="create-session" steps={STEPS} />);
    unmount();

    expect(destroyMock).not.toHaveBeenCalled();
  });

  afterEach(() => {
    cleanup();
  });
});

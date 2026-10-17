/**
 * Unit tests for WhatsNewList: the staff changelog page body.
 *
 * Asserts the behavior the feature exists for: unread entries are flagged,
 * opening the page records it as read (once, and only when something was
 * unread), the flags stay visible for the visit even after the layout refresh,
 * and nothing is sent when there is nothing new.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ChangelogEntry } from "@/types/changelog";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import WhatsNewList from "@/app/(admin)/_components/WhatsNewList";
import { entryKey } from "@/lib/changelog";

const newer: ChangelogEntry = {
  version: "1.8.0",
  date: "2026-10-15",
  kind: "new",
  title: "Brand new thing",
  summary: "You can do the thing.",
  href: "/admin/thing",
};
const older: ChangelogEntry = {
  version: "1.7.0",
  date: "2026-10-10",
  kind: "fixed",
  title: "Old fix",
  summary: "It was fixed.",
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

describe("WhatsNewList", () => {
  test("groups entries under their version with a readable date", () => {
    render(<WhatsNewList entries={[newer, older]} unreadKeys={[]} />);
    expect(screen.getByRole("heading", { name: "Version 1.8.0" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Version 1.7.0" })).toBeInTheDocument();
    expect(screen.getByText("October 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Brand new thing")).toBeInTheDocument();
  });

  test("flags only the unread entries", () => {
    render(<WhatsNewList entries={[newer, older]} unreadKeys={[entryKey(newer)]} />);
    expect(screen.getAllByText("Unread")).toHaveLength(1);
  });

  test("renders a link to the feature when the entry has one", () => {
    render(<WhatsNewList entries={[newer, older]} unreadKeys={[]} />);
    expect(screen.getByRole("link", { name: "Go to this feature" })).toHaveAttribute(
      "href",
      "/admin/thing"
    );
  });

  test("marks the changelog read once when something was unread, then refreshes the layout", async () => {
    render(<WhatsNewList entries={[newer, older]} unreadKeys={[entryKey(newer)]} />);
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/profile/whats-new-seen", { method: "POST" });
  });

  test("sends nothing when there is nothing unread", () => {
    render(<WhatsNewList entries={[newer, older]} unreadKeys={[]} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  test("keeps the unread flags visible for this visit after the layout refreshes", async () => {
    const { rerender } = render(
      <WhatsNewList entries={[newer, older]} unreadKeys={[entryKey(newer)]} />
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // The server re-renders the page with an empty unread list after the save.
    rerender(<WhatsNewList entries={[newer, older]} unreadKeys={[]} />);
    expect(screen.getAllByText("Unread")).toHaveLength(1);
  });

  test("does not refresh when the save fails", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<WhatsNewList entries={[newer]} unreadKeys={[entryKey(newer)]} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  test("shows an empty state when a role has no entries", () => {
    render(<WhatsNewList entries={[]} unreadKeys={[]} />);
    expect(screen.getByText("Nothing to show yet.")).toBeInTheDocument();
  });
});

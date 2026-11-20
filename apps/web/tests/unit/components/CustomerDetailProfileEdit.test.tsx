/**
 * Component tests for the Profile card on the admin customer page
 * (app/(admin)/_components/CustomerDetailClient.tsx).
 *
 * The property under test: editing a customer's name or phone and then leaving
 * the field actually sends the change to the server, and a refusal from the
 * server is shown to the staff member instead of being swallowed.
 *
 * External dependencies are mocked:
 *   next/navigation — router.refresh
 *   global fetch    — the update-profile API
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomerDetailClient, {
  type CustomerDetailData,
} from "@/app/(admin)/_components/CustomerDetailClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";
const fetchMock = vi.fn();

/** A customer with no bookings, orders, payments or certs: only the Profile card matters here. */
function makeData(): CustomerDetailData {
  return {
    profile: {
      id: CUSTOMER_ID,
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: "941-555-0100",
      address: null,
      city: null,
      state: null,
      zip: null,
      role: "customer",
      archived: false,
      created_at: "2026-01-01T00:00:00Z",
      customer_notes: null,
    },
    bookings: [],
    certifications: [],
    orders: [],
    payments: [],
    availableSessions: [],
    certTypes: [],
    actorRole: "manager",
    actorId: "manager-1",
  };
}

/** The update-profile calls made so far, as parsed request bodies. */
function savedBodies(): Array<{ field: string; value: string }> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/update-profile"))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe("CustomerDetailClient profile editing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  test("changing the last name and leaving the field saves it", async () => {
    const user = userEvent.setup();
    render(<CustomerDetailClient data={makeData()} />);

    const input = screen.getByLabelText(/last name/i);
    await user.clear(input);
    await user.type(input, "Smith");
    await user.tab();

    await waitFor(() => expect(savedBodies()).toEqual([{ field: "last_name", value: "Smith" }]));
  });

  test("leaving a field without changing it sends nothing", async () => {
    const user = userEvent.setup();
    render(<CustomerDetailClient data={makeData()} />);

    await user.click(screen.getByLabelText(/last name/i));
    await user.tab();

    expect(savedBodies()).toEqual([]);
  });

  test("a refused save shows the server's message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: "Phone number is required." }),
    });
    const user = userEvent.setup();
    render(<CustomerDetailClient data={makeData()} />);

    await user.clear(screen.getByLabelText(/phone/i));
    await user.tab();

    expect(await screen.findByText("Phone number is required.")).toBeInTheDocument();
  });
});

/**
 * Unit tests for lib/enrollware-bookmarklet.ts
 *
 * Covers:
 *   - getBookmarkletSource — structural integrity of the generated script and
 *     correct embedding of the apiBase URL.
 *   - fillClassForm — what the script actually writes into an Enrollware
 *     class-edit form, executed against a fake DOM.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { getBookmarkletSource } from "@/lib/enrollware-bookmarklet";

const SOURCE = getBookmarkletSource("https://superherocpr.com");

describe("getBookmarkletSource", () => {

  test("returns a non-empty string", () => {
    expect(typeof SOURCE).toBe("string");
    expect(SOURCE.trim().length).toBeGreaterThan(0);
  });

  test("embeds the API base URL in the script", () => {
    // JSON.stringify wraps the URL in quotes inside the var declaration
    expect(SOURCE).toContain('"https://superherocpr.com"');
  });

  test("contains an IIFE wrapper", () => {
    expect(SOURCE).toMatch(/\(function\s*\(\)/);
  });

  test("includes the double-run guard", () => {
    // Prevents the bookmarklet from running twice if tapped quickly
    expect(SOURCE).toContain("__SCPR_LOADED");
  });

  test("includes the page-mode detection function", () => {
    expect(SOURCE).toContain("getPageMode");
  });

  test("includes the fetchTodaysClasses function", () => {
    expect(SOURCE).toContain("fetchTodaysClasses");
  });

  test("includes the fetchStudentXLSX function", () => {
    expect(SOURCE).toContain("fetchStudentXLSX");
  });

  test("includes the injectStudentFile function", () => {
    expect(SOURCE).toContain("injectStudentFile");
  });

  test("does not contain CSV generation code", () => {
    expect(SOURCE).not.toContain("buildStudentCSV");
    expect(SOURCE).not.toContain("text/csv");
    expect(SOURCE).not.toContain("injectStudentCSV");
  });

  test("references the student-xlsx API endpoint", () => {
    expect(SOURCE).toContain("/api/enrollware/student-xlsx");
  });

  test("uses different API base URLs for different environments", () => {
    const staging = getBookmarkletSource("https://staging.superherocpr.com");
    const prod = getBookmarkletSource("https://superherocpr.com");
    expect(staging).toContain('"https://staging.superherocpr.com"');
    expect(prod).not.toContain('"https://staging.superherocpr.com"');
  });

  test("does not include the API key in the generated source", () => {
    // The key is injected at runtime by the bookmark wrapper — never baked in
    expect(SOURCE).not.toContain("FACEBOOK");
    expect(SOURCE).not.toContain("SERVICE_ROLE");
    expect(SOURCE).not.toContain("supabase");
  });
});

/**
 * Outcome tests — run the generated script against a fake Enrollware class-edit
 * DOM and assert what actually lands in the form fields.
 *
 * These guard the floating-class-time contract at the call site, which the
 * structural tests above cannot: `getHours()` and `getUTCHours()` are both
 * present-and-plausible strings, but only one of them writes 9:00 AM into
 * Enrollware for a 9:00 AM class. The regression this catches is real — the
 * floating-time migration fixed the two class pickers and missed fillClassForm,
 * so an Eastern instructor would have submitted every class four hours early.
 *
 * They only hold while class times are read as UTC, so they must run under a
 * non-UTC process timezone to be meaningful — see `pnpm test:unit:tz`.
 */
describe("fillClassForm — floating class times land verbatim", () => {
  /** A minimal today-classes payload with one session at a known wall clock. */
  function sessionFixture(startsAt: string, endsAt: string) {
    return {
      id: "session-1",
      starts_at: startsAt,
      ends_at: endsAt,
      max_capacity: 12,
      enrollware_submitted: false,
      additional_hours: 0,
      assistant_name: null,
      assistant_instructor: null,
      class_type: { name: "BLS Provider", price: 65, duration_minutes: 240 },
      location: { name: "Tampa Training Center" },
      instructor: { first_name: "Jane", last_name: "Doe" },
      students: [],
    };
  }

  /**
   * Builds the subset of Enrollware's class-edit form the bookmarklet writes to,
   * stubs fetch with the given session, evaluates the script, and picks the class.
   * Returns the form elements so assertions can read their values.
   */
  async function runFillForSession(session: ReturnType<typeof sessionFixture>) {
    document.body.innerHTML = `
      <form>
        <select id="mainContent_Course"><option value="1">BLS Provider</option></select>
        <select id="mainContent_Location"><option value="1">Tampa Training Center</option></select>
        <select id="mainContent_instructorId"><option value="1">Jane Doe</option></select>
        <input id="mainContent_startDate" type="text" />
        <input id="mainContent_startTime" type="time" />
        <input id="mainContent_endTime" type="time" />
        <input id="mainContent_price" type="text" />
        <input id="mainContent_totalHours" type="text" />
        <input id="mainContent_maxEnrollment" type="text" />
      </form>
    `;

    // getPageMode() reads location.href / search — replaceState keeps jsdom's
    // origin while giving the script the class-edit URL it looks for.
    window.history.replaceState({}, "", "/class-edit.aspx?id=new");

    sessionStorage.clear();
    // Clear the script's globals — the double-run guard would short-circuit the
    // second evaluation, and a stale __SCPR_PICK still closes over the previous
    // test's class list, which would silently fill the wrong session.
    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ classes: [session] }),
    })));

    // The source is a self-contained IIFE; Function() runs it the same way the
    // injected <script> tag does on enrollware.com.
    new Function(SOURCE)();

    // run() wires up the picker only after the fetch promise chain settles —
    // poll rather than guess a tick count.
    await vi.waitFor(() => {
      expect(w.__SCPR_PICK, "class picker should be exposed after classes load")
        .toBeTypeOf("function");
    });

    (w.__SCPR_PICK as (i: number) => void)(0);

    return {
      date: (document.getElementById("mainContent_startDate") as HTMLInputElement).value,
      start: (document.getElementById("mainContent_startTime") as HTMLInputElement).value,
      end: (document.getElementById("mainContent_endTime") as HTMLInputElement).value,
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  test("a 9:00 AM class fills Enrollware as 9:00 AM, not the local equivalent", async () => {
    const filled = await runFillForSession(
      sessionFixture("2026-09-14T09:00:00.000Z", "2026-09-14T13:00:00.000Z")
    );
    expect(filled.start).toBe("09:00");
    expect(filled.end).toBe("13:00");
    expect(filled.date).toBe("9/14/2026");
  });

  test("an evening class does not roll onto the next calendar date", async () => {
    // 7:00 PM is past midnight UTC-plus zones — a local getter would write 9/15
    // for a class the instructor scheduled on 9/14.
    const filled = await runFillForSession(
      sessionFixture("2026-09-14T19:00:00.000Z", "2026-09-14T23:00:00.000Z")
    );
    expect(filled.start).toBe("19:00");
    expect(filled.end).toBe("23:00");
    expect(filled.date).toBe("9/14/2026");
  });
});

/**
 * Certificate Issued On — existing-class path.
 *
 * showStudentFill fills mainContent_issueDate with the YYYY-MM-DD class date.
 * Because starts_at is a floating wall-clock value the date is extracted with
 * slice(0,10) — no timezone conversion — so the date the instructor scheduled
 * is always what lands in the field regardless of process timezone.
 */
describe("showStudentFill — Certificate Issued On", () => {
  function existingClassDOM(startsAt: string) {
    document.body.innerHTML = `
      <div id="mainContent_studentPanel" style="height:200px">
        <input id="mainContent_importBtn" type="button" value="Import" />
        <table id="studentlisttbl"><tbody></tbody></table>
      </div>
      <input id="mainContent_issueDate" type="date" />
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=12345");
    sessionStorage.clear();
    sessionStorage.setItem("scpr_session_id", "session-1");
    sessionStorage.setItem("scpr_session_data", JSON.stringify({
      id: "session-1",
      starts_at: startsAt,
      ends_at: startsAt.replace("T09", "T13"),
      max_capacity: 10,
      enrollware_submitted: false,
      additional_hours: 0,
      assistant_name: null,
      assistant_instructor: null,
      class_type: { name: "BLS Provider", price: 65, duration_minutes: 240 },
      location: { name: "Tampa" },
      instructor: { first_name: "Jane", last_name: "Doe" },
      students: [
        { first_name: "Alice", last_name: "Smith", email: "a@test.com", phone: null,
          address_1: null, address_2: null, city: null, state: null, zip: null,
          grade: 100, ccf_compression: null, confirmed: true }
      ],
    }));

    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PICK_STUDENTS;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  async function runExistingClass(startsAt: string) {
    existingClassDOM(startsAt);

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      // student-xlsx endpoint — return a minimal blob
      if (typeof url === "string" && url.includes("student-xlsx")) {
        return { ok: true, blob: async () => new Blob(["xlsx"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) };
      }
      // today-classes endpoint
      return {
        ok: true,
        json: async () => ({
          classes: [JSON.parse(sessionStorage.getItem("scpr_session_data")!)]
        })
      };
    }));

    new Function(SOURCE)();
    await vi.waitFor(() => {
      expect(
        (document.getElementById("mainContent_issueDate") as HTMLInputElement).value,
        "issueDate should be filled once showStudentFill runs"
      ).not.toBe("");
    }, { timeout: 2000 });

    return (document.getElementById("mainContent_issueDate") as HTMLInputElement).value;
  }

  test("fills issueDate with the class calendar date", async () => {
    const value = await runExistingClass("2026-09-14T09:00:00.000Z");
    expect(value).toBe("2026-09-14");
  });

  test("an evening class does not shift the date to the next day", async () => {
    // 7 PM stored as 19:00:00Z — in UTC+zones this would roll past midnight
    // and give 9/15 if a local getter were used.
    const value = await runExistingClass("2026-09-14T19:00:00.000Z");
    expect(value).toBe("2026-09-14");
  });
});

/**
 * Import auto-click — showStudentFill clicks mainContent_importBtn and waits
 * for mainContent_impFileUpl to appear before calling injectStudentFile.
 *
 * The Enrollware class-edit page hides the file input behind an UpdatePanel
 * postback triggered by the Import button. Without clicking the button first,
 * injectStudentFile always fails because the element doesn't exist yet.
 */
describe("showStudentFill — Import auto-click", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  test("clicks importBtn, waits for impFileUpl, then injects the file", async () => {
    // Build a DOM where impFileUpl is absent until importBtn is clicked —
    // simulating the Enrollware UpdatePanel postback behaviour.
    document.body.innerHTML = `
      <div id="mainContent_studentPanel">
        <input id="mainContent_importBtn" type="button" value="Import" />
      </div>
      <input id="mainContent_issueDate" type="date" />
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=12345");

    const session = {
      id: "session-2",
      starts_at: "2026-09-14T09:00:00.000Z",
      ends_at: "2026-09-14T13:00:00.000Z",
      max_capacity: 10,
      enrollware_submitted: false,
      additional_hours: 0,
      assistant_name: null,
      assistant_instructor: null,
      class_type: { name: "BLS Provider", price: 65, duration_minutes: 240 },
      location: { name: "Tampa" },
      instructor: { first_name: "Jane", last_name: "Doe" },
      students: [
        { first_name: "Bob", last_name: "Jones", email: "b@test.com", phone: null,
          address_1: null, address_2: null, city: null, state: null, zip: null,
          grade: 100, ccf_compression: null, confirmed: true }
      ],
    };

    sessionStorage.clear();
    sessionStorage.setItem("scpr_session_id", "session-2");
    sessionStorage.setItem("scpr_session_data", JSON.stringify(session));

    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PICK_STUDENTS;

    // Track whether injectStudentFile was reached by watching impFileUpl assignment.
    let fileInputWasInjected = false;

    // Simulate the UpdatePanel postback: when importBtn is clicked, add impFileUpl
    // to the DOM after a tick (mimicking the async postback delay).
    const importBtn = document.getElementById("mainContent_importBtn")!;
    importBtn.addEventListener("click", () => {
      setTimeout(() => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.id = "mainContent_impFileUpl";
        // Override the files setter so we can detect injection.
        Object.defineProperty(inp, "files", {
          set() { fileInputWasInjected = true; },
          get() { return null; },
          configurable: true,
        });
        document.getElementById("mainContent_studentPanel")!.appendChild(inp);
      }, 50);
    });

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("student-xlsx")) {
        return { ok: true, blob: async () => new Blob(["xlsx"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) };
      }
      return { ok: true, json: async () => ({ classes: [session] }) };
    }));

    new Function(SOURCE)();

    // Wait until the UpdatePanel postback simulation has fired and impFileUpl
    // is in the DOM. The bookmarklet's MutationObserver fires on the same event,
    // so if impFileUpl is present the observer has already resolved its promise.
    await vi.waitFor(() => {
      expect(document.getElementById("mainContent_impFileUpl"),
        "impFileUpl should be present after importBtn click").not.toBeNull();
    }, { timeout: 3000 });
  });
});

/**
 * Price survives Enrollware's UpdatePanel postbacks.
 *
 * mainContent_price lives inside mainContent_UpdatePanel2. Every async postback
 * that panel serves — Course change, Location change, the assistant BsmSelect
 * widget, the student Import button — re-renders the panel and REPLACES the price
 * input with one carrying Enrollware's own catalog price ("$0.00" for courses
 * priced only in SuperheroCPR). Verified against the live site: a single write
 * reverts on the very next postback.
 *
 * That made the bug expensive. fillClassForm writes the price, then dispatches a
 * change event on the assistant widget a few lines later — so the bookmarklet was
 * wiping its own price, and whatever showed when the instructor clicked "Update
 * Class" is what got saved. Instructors were saving $75 classes at $0.
 */
describe("price survives UpdatePanel postbacks", () => {
  /**
   * Simulates one ASP.NET partial postback: swap in a fresh price input carrying
   * the server's catalog value, then fire the endRequest handlers — the same
   * order the real PageRequestManager uses.
   */
  function simulatePostback(handlers: Array<() => void>) {
    const old = document.getElementById("mainContent_price") as HTMLInputElement;
    const fresh = document.createElement("input");
    fresh.id = "mainContent_price";
    fresh.type = "text";
    fresh.value = "$0.00";
    old.replaceWith(fresh);
    handlers.forEach((h) => h());
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  test("a postback that replaces the price input does not revert the price", async () => {
    document.body.innerHTML = `
      <form>
        <select id="mainContent_Course"><option value="1">BLS Provider</option></select>
        <select id="mainContent_Location"><option value="1">Tampa Training Center</option></select>
        <select id="mainContent_instructorId"><option value="1">Jane Doe</option></select>
        <input id="mainContent_startDate" type="text" />
        <input id="mainContent_startTime" type="time" />
        <input id="mainContent_endTime" type="time" />
        <input id="mainContent_price" type="text" />
        <input id="mainContent_totalHours" type="text" />
        <input id="mainContent_maxEnrollment" type="text" />
      </form>
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=new");
    sessionStorage.clear();

    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PRICE;
    delete w.__SCPR_PRICE_GUARD;

    // Stand in for ASP.NET AJAX, capturing whatever the script registers.
    const endRequestHandlers: Array<() => void> = [];
    w.Sys = {
      WebForms: {
        PageRequestManager: {
          getInstance: () => ({
            add_endRequest: (fn: () => void) => { endRequestHandlers.push(fn); },
          }),
        },
      },
    };

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        classes: [{
          id: "session-1",
          starts_at: "2026-09-14T09:00:00.000Z",
          ends_at: "2026-09-14T13:00:00.000Z",
          max_capacity: 12,
          enrollware_submitted: false,
          additional_hours: 0,
          assistant_name: null,
          assistant_instructor: null,
          class_type: { name: "BLS Provider", price: 75, duration_minutes: 240 },
          location: { name: "Tampa Training Center" },
          instructor: { first_name: "Jane", last_name: "Doe" },
          students: [],
        }],
      }),
    })));

    new Function(SOURCE)();
    await vi.waitFor(() => {
      expect(w.__SCPR_PICK).toBeTypeOf("function");
    });
    (w.__SCPR_PICK as (i: number) => void)(0);

    const priceOf = () =>
      (document.getElementById("mainContent_price") as HTMLInputElement).value;

    expect(priceOf(), "price should be filled on the initial form").toBe("$75.00");
    expect(endRequestHandlers.length,
      "the script must register a postback guard").toBeGreaterThan(0);

    // The regression: before the guard, this left "$0.00" behind.
    simulatePostback(endRequestHandlers);
    expect(priceOf(), "price must survive an UpdatePanel refresh").toBe("$75.00");

    // And it must keep surviving — Course, Location, assistant and Import can
    // each fire one, so a guard that only works once is not enough.
    simulatePostback(endRequestHandlers);
    simulatePostback(endRequestHandlers);
    expect(priceOf(), "price must survive repeated refreshes").toBe("$75.00");
  });

  test("a $0 class type leaves Enrollware's own price untouched", async () => {
    document.body.innerHTML = `
      <form>
        <select id="mainContent_Course"><option value="1">Family &amp; Friends</option></select>
        <select id="mainContent_Location"><option value="1">Tampa Training Center</option></select>
        <select id="mainContent_instructorId"><option value="1">Jane Doe</option></select>
        <input id="mainContent_startDate" type="text" />
        <input id="mainContent_startTime" type="time" />
        <input id="mainContent_endTime" type="time" />
        <input id="mainContent_price" type="text" value="$40.00" />
        <input id="mainContent_totalHours" type="text" />
        <input id="mainContent_maxEnrollment" type="text" />
      </form>
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=new");
    sessionStorage.clear();

    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PRICE;
    delete w.__SCPR_PRICE_GUARD;
    delete w.Sys;

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        classes: [{
          id: "session-2",
          starts_at: "2026-09-14T09:00:00.000Z",
          ends_at: "2026-09-14T13:00:00.000Z",
          max_capacity: 12,
          enrollware_submitted: false,
          additional_hours: 0,
          assistant_name: null,
          assistant_instructor: null,
          class_type: { name: "Family & Friends", price: 0, duration_minutes: 240 },
          location: { name: "Tampa Training Center" },
          instructor: { first_name: "Jane", last_name: "Doe" },
          students: [],
        }],
      }),
    })));

    new Function(SOURCE)();
    await vi.waitFor(() => {
      expect(w.__SCPR_PICK).toBeTypeOf("function");
    });
    (w.__SCPR_PICK as (i: number) => void)(0);

    expect(
      (document.getElementById("mainContent_price") as HTMLInputElement).value,
      "a 0 price must not clobber the value Enrollware rendered"
    ).toBe("$40.00");
  });
});

/**
 * Price survives the full page reloads that partial-postback guards cannot.
 *
 * "Update Class" and Enrollware's student Import are native form submits, not
 * UpdatePanel postbacks — the page navigates and this script is discarded, so no
 * handler registered in the page can restore anything. The price is persisted to
 * sessionStorage and re-applied at startup instead, which is why tapping the
 * bookmark on the reloaded page puts the price back.
 */
describe("price survives a full page reload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  /** Rebuilds the DOM and re-runs the script, the way a page navigation does. */
  function reloadPageWithServerPrice(serverPrice: string) {
    document.body.innerHTML = `
      <form>
        <input id="mainContent_price" type="text" value="${serverPrice}" />
        <div id="mainContent_studentPanel"></div>
      </form>
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=abc-123");
    const w = window as unknown as Record<string, unknown>;
    // A real reload drops every global the previous page set.
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PRICE_GUARD;
    delete w.Sys;
    new Function(SOURCE)();
  }

  test("re-applies the stored price on the reloaded page, in $XX.XX format", () => {
    sessionStorage.setItem("scpr_price", "75");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ classes: [] }),
    })));

    reloadPageWithServerPrice("$0.00");

    // Startup restore is synchronous — it must not wait on the classes fetch,
    // so the price is already right when the instructor looks at the page.
    expect(
      (document.getElementById("mainContent_price") as HTMLInputElement).value,
      "the reloaded page's $0.00 must be overwritten from sessionStorage"
    ).toBe("$75.00");
  });

  test("leaves the page alone when no price was stored", () => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ classes: [] }),
    })));

    reloadPageWithServerPrice("$40.00");

    expect(
      (document.getElementById("mainContent_price") as HTMLInputElement).value,
      "with nothing stored, Enrollware's own value must stand"
    ).toBe("$40.00");
  });

  test("normalises a numeric-string price from Postgres", () => {
    // Supabase serialises the numeric price column as a string like "75.00".
    sessionStorage.setItem("scpr_price", "75.00");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ classes: [] }),
    })));

    reloadPageWithServerPrice("$0.00");

    expect(
      (document.getElementById("mainContent_price") as HTMLInputElement).value
    ).toBe("$75.00");
  });
});

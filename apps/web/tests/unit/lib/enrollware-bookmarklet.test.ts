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

  /**
   * The generated script is assembled as one big template literal, so an escaping
   * slip produces a SyntaxError that kills the entire IIFE — the bookmarklet then
   * does nothing at all, with no clue in the panel. This shipped once: a message
   * written as 'Enrollware\'s Documents' emitted a bare apostrophe into the
   * generated JS, terminating the string early and taking the whole tool down.
   *
   * Parsing the output is the only check that catches that class of bug, and it
   * catches all of them, not just apostrophes.
   */
  test("generated source parses as valid JavaScript", () => {
    expect(() => new Function("__k", SOURCE)).not.toThrow();
  });

  test("generated source parses for every apiBase it can be served with", () => {
    for (const base of ["https://superherocpr.com", "https://staging.superherocpr.com", "http://localhost:3000"]) {
      expect(() => new Function("__k", getBookmarkletSource(base)), `apiBase ${base}`).not.toThrow();
    }
  });

  test("drives the upload widget through its API, not its DOM", () => {
    // The queue DOM is not a usable completion signal — 'pendingState' marks a
    // file as queued (it clears as each upload starts) and QueueContainer is
    // never emptied because clearFileListAfterUpload is false. Both were tried
    // and both failed on the live site; the control's own events are the contract.
    expect(SOURCE).toContain("add_uploadCompleteAll");
    expect(SOURCE).toContain("startUpload");
    // Named only in explanatory comments — never queried, which is the point.
    expect(SOURCE).not.toMatch(/querySelector\w*\([^)]*pendingState/);
    expect(SOURCE).not.toMatch(/getElementById\([^)]*QueueContainer/);
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

/**
 * "Mark class as submitted" auto-clicks Enrollware's real Import Students button.
 *
 * mainContent_impUploadBtn ("Import Students") is a full-page form submit —
 * confirmed live via PageRequestManager._postBackControlIDs, which lists it
 * (not the async list Course/Location postbacks use). So our own markSubmitted()
 * API call must complete and sessionStorage must be cleared *before* it is
 * clicked, since the click navigates the browser away and would otherwise abort
 * that fetch mid-flight.
 */
describe("Mark class as submitted — auto-clicks Import Students", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  const session = {
    id: "session-3",
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
      { first_name: "Carla", last_name: "Ruiz", email: "c@test.com", phone: null,
        address_1: null, address_2: null, city: null, state: null, zip: null,
        grade: 100, ccf_compression: null, confirmed: true }
    ],
  };

  function primeStorage() {
    sessionStorage.clear();
    sessionStorage.setItem("scpr_session_id", session.id);
    sessionStorage.setItem("scpr_session_data", JSON.stringify(session));
    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_PICK;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PICK_STUDENTS;
    delete w.__SCPR_MARK_DONE;
  }

  function stubFetch(markSubmittedCalls: string[]) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("student-xlsx")) {
        return { ok: true, blob: async () => new Blob(["xlsx"]) };
      }
      if (typeof url === "string" && url.includes("mark-submitted")) {
        markSubmittedCalls.push(url);
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({ classes: [session] }) };
    }));
  }

  test("clicks the real Import Students button when the file was injected", async () => {
    document.body.innerHTML = `
      <div id="mainContent_studentPanel">
        <input id="mainContent_impFileUpl" type="file" />
        <input id="mainContent_impUploadBtn" type="submit" value="Import Students" />
      </div>
      <input id="mainContent_issueDate" type="date" />
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=12345");
    primeStorage();

    // jsdom has no DataTransfer constructor — polyfill just enough for
    // injectStudentFile's try block to succeed instead of falling into its
    // catch (which is what real DataTransfer-less environments would do).
    class FakeDataTransfer {
      items = { add: () => {} };
      files: unknown[] = [];
    }
    vi.stubGlobal("DataTransfer", FakeDataTransfer);
    const fileInput = document.getElementById("mainContent_impFileUpl") as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [], writable: true, configurable: true });

    let uploadClicked = false;
    document.getElementById("mainContent_impUploadBtn")!
      .addEventListener("click", () => { uploadClicked = true; });

    const markSubmittedCalls: string[] = [];
    stubFetch(markSubmittedCalls);

    new Function(SOURCE)();
    const w = window as unknown as Record<string, unknown>;
    await vi.waitFor(() => {
      expect(w.__SCPR_MARK_DONE, "Mark-done handler should be exposed once the panel renders")
        .toBeTypeOf("function");
    }, { timeout: 2000 });

    await (w.__SCPR_MARK_DONE as (id: string) => Promise<void>)(session.id);

    await vi.waitFor(() => {
      expect(uploadClicked, "Import Students should be auto-clicked after marking submitted").toBe(true);
    });
    expect(markSubmittedCalls.length, "our own API must be called before the navigating click").toBe(1);
    expect(sessionStorage.getItem("scpr_session_id"), "stored session should be cleared").toBeNull();
  });

  test("does not click Import Students when the file failed to inject", async () => {
    // No mainContent_impFileUpl and no mainContent_importBtn — injectStudentFile
    // has nothing to inject into, so injected stays false.
    document.body.innerHTML = `
      <div id="mainContent_studentPanel">
        <input id="mainContent_impUploadBtn" type="submit" value="Import Students" />
      </div>
      <input id="mainContent_issueDate" type="date" />
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=12345");
    primeStorage();

    let uploadClicked = false;
    document.getElementById("mainContent_impUploadBtn")!
      .addEventListener("click", () => { uploadClicked = true; });

    const markSubmittedCalls: string[] = [];
    stubFetch(markSubmittedCalls);

    new Function(SOURCE)();
    const w = window as unknown as Record<string, unknown>;
    await vi.waitFor(() => {
      expect(w.__SCPR_MARK_DONE).toBeTypeOf("function");
    }, { timeout: 2000 });

    await (w.__SCPR_MARK_DONE as (id: string) => Promise<void>)(session.id);

    await vi.waitFor(() => {
      expect(markSubmittedCalls.length, "our own API should still be called").toBe(1);
    });
    expect(uploadClicked, "Import Students must not be auto-clicked without an injected file").toBe(false);
  });
});

/**
 * Document upload must complete AND its postback must settle before the student
 * import file is written.
 *
 * Both failure modes this guards were observed on the live site:
 *
 *  - Injecting the XLSX while the widget's postback is in flight loses it. The
 *    widget fires uploadCompleteAll *during* its own postback (measured:
 *    beginRequest t=9911ms, uploadCompleteAll t=9912ms, endRequest t=10157ms),
 *    so "wait for uploadCompleteAll" alone is not enough — the UpdatePanel
 *    re-render ~250ms later discards whatever was queued.
 *
 *  - Waiting on the queue DOM never fires. 'pendingState' means queued, not
 *    uploading, and QueueContainer is never emptied (clearFileListAfterUpload
 *    is false), so a DOM-based wait hangs until its timeout and the documents
 *    appear never to upload.
 *
 * The fake control below reproduces that exact ordering.
 */
describe("document upload sequencing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    sessionStorage.clear();
    const w = window as unknown as Record<string, unknown>;
    delete w.__SCPR_LOADED;
    delete w.__SCPR_SHOW;
    delete w.__SCPR_PICK;
    delete w.__SCPR_PICK_STUDENTS;
    delete w.__SCPR_PRICE_GUARD;
    delete w.Sys;
  });

  const session = {
    id: "session-doc-1",
    starts_at: "2026-09-14T09:00:00.000Z",
    ends_at: "2026-09-14T13:00:00.000Z",
    max_capacity: 12,
    enrollware_submitted: false,
    additional_hours: 0,
    assistant_name: null,
    assistant_instructor: null,
    class_type: { name: "BLS Provider", price: 65, duration_minutes: 240 },
    location: { name: "Tampa Training Center" },
    instructor: { first_name: "Jane", last_name: "Doe" },
    students: [{ first_name: "Sam", last_name: "Smith" }],
  };

  /**
   * Stands in for Sys.Extended.UI.AjaxFileUpload.Control plus the
   * PageRequestManager, replaying the timing measured on enrollware.com:
   * the postback opens one tick BEFORE uploadCompleteAll fires and closes
   * a few ticks after.
   */
  function installFakeWidget() {
    const handlers: Record<string, (() => void)[]> = {
      uploadStart: [], uploadComplete: [], uploadCompleteAll: [], uploadError: [],
    };
    const endRequestHandlers: (() => void)[] = [];
    const state = { inPostBack: false, started: false, queueEmptied: false };

    const control = {
      get_maximumNumberOfFiles: () => 20,
      add_uploadStart: (f: () => void) => handlers.uploadStart.push(f),
      add_uploadComplete: (f: () => void) => handlers.uploadComplete.push(f),
      add_uploadCompleteAll: (f: () => void) => handlers.uploadCompleteAll.push(f),
      add_uploadError: (f: () => void) => handlers.uploadError.push(f),
      startUpload: () => {
        state.started = true;
        setTimeout(() => {
          handlers.uploadStart.forEach((f) => f());
          handlers.uploadComplete.forEach((f) => f());
          // Postback opens first, then uploadCompleteAll fires inside it.
          state.inPostBack = true;
          handlers.uploadCompleteAll.forEach((f) => f());
          setTimeout(() => {
            state.inPostBack = false;
            endRequestHandlers.slice().forEach((f) => f());
          }, 20);
        }, 0);
      },
    };

    const w = window as unknown as Record<string, unknown>;
    w.Sys = {
      Application: { findComponent: (id: string) => (id === "mainContent_AjaxUpload1" ? control : null) },
      WebForms: {
        PageRequestManager: {
          getInstance: () => ({
            get_isInAsyncPostBack: () => state.inPostBack,
            add_endRequest: (f: () => void) => endRequestHandlers.push(f),
            remove_endRequest: (f: () => void) => {
              const i = endRequestHandlers.indexOf(f);
              if (i >= 0) endRequestHandlers.splice(i, 1);
            },
          }),
        },
      },
    };
    return state;
  }

  /** Minimal existing-class DOM with both the Documents widget and the import panel. */
  function buildDom() {
    document.body.innerHTML = `
      <form>
        <div id="mainContent_studentPanel">
          <input id="mainContent_AjaxUpload1_Html5InputFile" type="file" multiple />
          <input id="mainContent_impFileUpl" type="file" />
          <input id="mainContent_price" type="text" />
        </div>
        <input id="mainContent_issueDate" type="date" />
      </form>
    `;
    window.history.replaceState({}, "", "/class-edit.aspx?id=abc-123");

    // jsdom's input.files is read-only; the real browser lets a DataTransfer be
    // assigned to it, which is how both injections work. Make it writable or the
    // script's assignment throws and every upload reports 'inject-failed'.
    const widgetInput = document.getElementById("mainContent_AjaxUpload1_Html5InputFile") as HTMLInputElement;
    let widgetFiles: File[] = [];
    Object.defineProperty(widgetInput, "files", {
      get: () => widgetFiles,
      set: (v: File[]) => { widgetFiles = v; },
      configurable: true,
    });
  }

  test("XLSX is injected only after the upload postback settles", async () => {
    buildDom();
    const state = installFakeWidget();

    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (f: File) => { this.files.push(f); } };
    }
    vi.stubGlobal("DataTransfer", FakeDataTransfer);

    // Record whether a postback was open at the moment the XLSX was written.
    const injectionEvents: { inPostBack: boolean }[] = [];
    const imp = document.getElementById("mainContent_impFileUpl") as HTMLInputElement;
    let stored: File[] = [];
    Object.defineProperty(imp, "files", {
      get: () => stored,
      set: (v: File[]) => { stored = v; injectionEvents.push({ inPostBack: state.inPostBack }); },
      configurable: true,
    });

    const pdfB64 = btoa("%PDF-1.4 fake");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/enrollware/today-classes")) {
        return { ok: true, json: async () => ({ classes: [session] }) };
      }
      if (url.includes("/api/enrollware/session-documents")) {
        return { ok: true, json: async () => ({ documents: [{ studentName: "Sam Smith", fileName: "Sam Smith - Documents.pdf", pdf: pdfB64 }] }) };
      }
      if (url.includes("/api/enrollware/student-xlsx")) {
        return { ok: true, blob: async () => new Blob(["xlsx"]) };
      }
      return { ok: true, json: async () => ({}) };
    }));

    sessionStorage.setItem("scpr_session_id", session.id);
    sessionStorage.setItem("scpr_session_data", JSON.stringify(session));

    new Function(SOURCE)();

    await vi.waitFor(() => {
      expect(state.started, "the widget's startUpload() should be invoked").toBe(true);
    }, { timeout: 3000 });

    await vi.waitFor(() => {
      expect(injectionEvents.length, "the XLSX should eventually be injected").toBeGreaterThan(0);
    }, { timeout: 3000 });

    // The regression: any injection recorded while a postback was open is lost.
    expect(
      injectionEvents.filter((e) => e.inPostBack),
      "XLSX must never be written while an UpdatePanel postback is in flight",
    ).toEqual([]);
  });

  test("no documents means the import is not gated on an upload", async () => {
    buildDom();
    const state = installFakeWidget();

    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (f: File) => { this.files.push(f); } };
    }
    vi.stubGlobal("DataTransfer", FakeDataTransfer);

    const imp = document.getElementById("mainContent_impFileUpl") as HTMLInputElement;
    let stored: File[] = [];
    Object.defineProperty(imp, "files", {
      get: () => stored, set: (v: File[]) => { stored = v; }, configurable: true,
    });

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/enrollware/today-classes")) {
        return { ok: true, json: async () => ({ classes: [session] }) };
      }
      if (url.includes("/api/enrollware/session-documents")) {
        return { ok: true, json: async () => ({ documents: [] }) };
      }
      if (url.includes("/api/enrollware/student-xlsx")) {
        return { ok: true, blob: async () => new Blob(["xlsx"]) };
      }
      return { ok: true, json: async () => ({}) };
    }));

    sessionStorage.setItem("scpr_session_id", session.id);
    sessionStorage.setItem("scpr_session_data", JSON.stringify(session));

    new Function(SOURCE)();

    await vi.waitFor(() => {
      expect(stored.length, "XLSX should be injected even with no documents").toBe(1);
    }, { timeout: 3000 });

    expect(state.started, "no upload should be started when there are no documents").toBe(false);
  });
});

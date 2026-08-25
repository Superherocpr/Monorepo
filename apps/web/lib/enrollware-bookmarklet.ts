/**
 * Enrollware autofill bookmarklet source.
 * This module exports a function that returns the complete bookmarklet JavaScript
 * as a string. It is served by /api/enrollware/bookmarklet and executed on the
 * enrollware.com domain via the instructor's saved bookmark.
 *
 * The script receives two injected variables from the bookmark wrapper:
 *   __k  — the instructor's API key (Bearer token)
 *   __b  — the SuperheroCPR API base URL (e.g. "https://superherocpr.com")
 *
 * Flow:
 *   1. Detects whether the page is a new-class form or an existing class with
 *      the student list visible.
 *   2. Fetches today's classes from /api/enrollware/today-classes.
 *   3. On a new-class page: shows a class picker overlay, fills all form fields
 *      using name-based dropdown matching, injects a MutationObserver to watch
 *      for the student list panel to appear after "Update Class" is clicked.
 *   4. When the student panel appears (or on a reload with the student panel
 *      already present): fetches an xlsx roster from the SuperheroCPR API and
 *      injects it into Enrollware's file input.
 *   5. "Mark class as submitted": records the submission via
 *      /api/enrollware/mark-submitted, then (if the file was injected
 *      successfully) clicks Enrollware's own "Import Students" button so the
 *      instructor doesn't have to do it as a separate step.
 *
 * Server-side only. This file is never imported by client components.
 */

/**
 * Returns the full bookmarklet JavaScript source as a string.
 * @param apiBase - The absolute base URL of the SuperheroCPR deployment
 *                  (e.g. "https://superherocpr.com"). Injected at serve time.
 */
export function getBookmarkletSource(apiBase: string): string {
  // The apiBase is embedded directly in the script at serve time —
  // only __k (the API key) is injected at runtime by the bookmark wrapper.
  // This avoids exposing the API key in server logs via query parameters.
  //
  // The returned text is a complete self-contained IIFE. The bookmark wrapper
  // must set window.__SCPR_KEY before injecting so the IIFE can read the key.
  return `
(function() {
  'use strict';

  // Read the API key from the global set by the bookmark wrapper before
  // this script was injected. Falls back to empty string (auth will fail
  // with a clear error message from the API).
  var __k = window.__SCPR_KEY || '';
  var API_BASE = ${JSON.stringify(apiBase)};

  // --- Guard: prevent double-running if bookmarklet is tapped twice ---
  if (window.__SCPR_LOADED) {
    if (window.__SCPR_SHOW) window.__SCPR_SHOW();
    return;
  }
  window.__SCPR_LOADED = true;

  // =========================================================
  // Page detection
  // =========================================================

  /**
   * Returns 'new-class' if on the class creation form, 'existing-class' if
   * on a saved class page (where the student list may be present), or null
   * if the current page is not a recognized Enrollware class-edit page.
   */
  function getPageMode() {
    var href = window.location.href.toLowerCase();
    if (href.indexOf('class-edit.aspx') === -1) return null;
    var params = new URLSearchParams(window.location.search);
    var id = (params.get('id') || params.get('Id') || '').toLowerCase();
    if (!id || id === 'new') return 'new-class';
    return 'existing-class';
  }

  // =========================================================
  // API helpers
  // =========================================================

  /** Fetches today's classes from the SuperheroCPR API. */
  function fetchTodaysClasses() {
    // Pass the browser's IANA timezone so the server can compute "today" in
    // the instructor's local calendar — prevents the UTC-day-rollover bug
    // where evening usage would otherwise return no classes.
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var url = API_BASE + '/api/enrollware/today-classes' +
              (tz ? ('?tz=' + encodeURIComponent(tz)) : '');
    return fetch(url, {
      headers: { 'Authorization': 'Bearer ' + __k }
    }).then(function(r) {
      return r.json().then(function(data) {
        if (!r.ok) throw new Error(data.error || ('API error ' + r.status));
        return data;
      });
    });
  }

  /** Marks a class session as submitted in the SuperheroCPR database. */
  function markSubmitted(sessionId) {
    return fetch(API_BASE + '/api/enrollware/mark-submitted', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + __k,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionId: sessionId })
    });
  }

  // =========================================================
  // Name-based dropdown matching
  // =========================================================

  /**
   * Selects an option in a <select> element by matching the provided name
   * against option text content. Tries exact match first (case-insensitive),
   * then falls back to a containment check with a similarity threshold.
   * Does NOT dispatch a change event — values are set directly so that
   * ASP.NET UpdatePanel postbacks are NOT triggered prematurely. The selected
   * value will still be submitted correctly when the instructor clicks
   * "Update Class".
   *
   * Returns true if a match was found and selected, false otherwise.
   */
  function selectByName(selectEl, name) {
    if (!selectEl || !name) return false;
    var nameLower = name.toLowerCase().trim();
    var bestOption = null;
    var bestScore = 0;

    for (var i = 0; i < selectEl.options.length; i++) {
      var opt = selectEl.options[i];
      var optText = opt.text.toLowerCase().trim();

      if (optText === nameLower) {
        // Perfect match — set and return immediately
        selectEl.value = opt.value;
        return true;
      }

      // Partial match score: length of overlap relative to the longer string
      if (optText.indexOf(nameLower) !== -1 || nameLower.indexOf(optText) !== -1) {
        var score = Math.min(nameLower.length, optText.length) /
                    Math.max(nameLower.length, optText.length);
        if (score > bestScore) {
          bestScore = score;
          bestOption = opt;
        }
      }
    }

    // Accept a partial match only if similarity exceeds 60%
    if (bestOption && bestScore >= 0.6) {
      selectEl.value = bestOption.value;
      return true;
    }
    return false;
  }

  // =========================================================
  // Class form fill
  // =========================================================
  //
  // Floating class times: starts_at / ends_at hold the wall clock the
  // instructor typed, labelled Z but carrying no timezone meaning — a 9:00 AM
  // class is stored as 09:00:00Z (see lib/business-time.ts). So every class
  // time read in this script uses the getUTC* getters, or pins timeZone:'UTC'
  // when formatting. Plain getHours() in an Eastern browser would write 5:00 AM
  // into Enrollware for a 9:00 AM class.

  // ---------------------------------------------------------
  // Price — single source of truth
  // ---------------------------------------------------------
  //
  // mainContent_price lives inside mainContent_UpdatePanel2, Enrollware's only
  // UpdatePanel. Every async postback that panel serves — Course change, Location
  // change, the assistant BsmSelect widget, the student Import button — re-renders
  // the panel and REPLACES the price input node with one carrying Enrollware's own
  // catalog price ("$0.00" for most courses, since prices live in the SuperheroCPR
  // database rather than theirs). So writing the price once is never enough: the
  // next postback silently reverts it, and whatever is on screen when the
  // instructor clicks "Update Class" is what gets saved.
  //
  // The price is therefore written by exactly one function, re-invoked after every
  // partial postback via the PageRequestManager's endRequest event — which fires
  // once the replacement node is already in the DOM.
  //
  // Partial postbacks are only half the problem. "Update Class" and Enrollware's
  // student Import are full page submits: the page navigates, this script is
  // discarded, and the guard dies with it. Nothing running in the page can survive
  // that. So the price is also persisted to sessionStorage and re-applied at
  // startup — every tap of the bookmark restores it, on whichever class-edit page
  // the instructor has landed on.
  //
  // Format: "$75.00", matching what Enrollware renders into the field itself.
  // Since submitting an untouched form posts Enrollware's own "$0.00" back to its
  // server successfully, currency format is guaranteed to survive their parser.

  var PRICE_KEY = 'scpr_price';

  /** Formats a price as Enrollware renders it: "$75.00". Accepts 75, "75", "75.00". */
  function formatPrice(price) {
    return '$' + Number(price).toFixed(2);
  }

  /**
   * Reads the price recorded for this class and writes it into Enrollware's price
   * field. No-ops when the field is absent or no positive price was recorded, so
   * it is safe to call on any page at any point in the postback lifecycle.
   */
  function applyPrice() {
    var el = document.getElementById('mainContent_price');
    if (!el) return;
    var price = Number(sessionStorage.getItem(PRICE_KEY));
    if (price > 0) {
      el.value = formatPrice(price);
    }
  }

  /**
   * Records this session's price, writes it immediately, and installs the guard
   * that re-applies it after every UpdatePanel refresh. Safe to call repeatedly:
   * the endRequest handler is registered at most once per page load.
   *
   * A price of 0 (a free class type, or one not priced in SuperheroCPR) records
   * nothing and writes nothing, leaving Enrollware's own value untouched.
   *
   * Side effect: writes the price to sessionStorage so it outlives the full page
   * reloads that "Update Class" and the student Import trigger.
   */
  function installPriceGuard(session) {
    var price = Number((session && session.class_type) ? session.class_type.price : 0);
    if (price > 0) {
      sessionStorage.setItem(PRICE_KEY, String(price));
    } else {
      // Clear it — otherwise switching to a free class type would keep applying
      // the previously selected class's price.
      sessionStorage.removeItem(PRICE_KEY);
    }
    installPriceWatcher();
    applyPrice();
  }

  /**
   * Registers applyPrice to run after every partial postback. Idempotent — the
   * handler is added at most once per page load.
   */
  function installPriceWatcher() {
    if (window.__SCPR_PRICE_GUARD) return;
    try {
      var prm = (window.Sys && Sys.WebForms && Sys.WebForms.PageRequestManager)
        ? Sys.WebForms.PageRequestManager.getInstance()
        : null;
      if (prm) {
        prm.add_endRequest(applyPrice);
        window.__SCPR_PRICE_GUARD = true;
      }
    } catch (e) {
      // No ASP.NET AJAX on this page — the direct writes still stand.
    }
  }

  /**
   * Fills all class-detail form fields using the provided session data.
   * Returns an array of warning strings for any fields that could not be
   * auto-filled (e.g. unmatched course or location name).
   */
  function fillClassForm(session) {
    var warnings = [];

    // Course — name-match against Enrollware course dropdown
    var courseEl = document.getElementById('mainContent_Course');
    if (courseEl && session.class_type) {
      if (!selectByName(courseEl, session.class_type.name)) {
        warnings.push('Could not match course: "' + session.class_type.name + '"');
      }
    }

    // Location — name-match against Enrollware location dropdown
    var locationEl = document.getElementById('mainContent_Location');
    if (locationEl && session.location) {
      if (!selectByName(locationEl, session.location.name)) {
        warnings.push('Could not match location: "' + session.location.name + '"');
      }
    }

    // Instructor — match by "First Last" full name
    var instructorEl = document.getElementById('mainContent_instructorId');
    if (instructorEl && session.instructor) {
      var fullName = session.instructor.first_name + ' ' + session.instructor.last_name;
      if (!selectByName(instructorEl, fullName)) {
        warnings.push('Could not match instructor: "' + fullName + '"');
      }
    }

    // Date — text input, format: M/D/YYYY (Enrollware's expected format)
    var dateEl = document.getElementById('mainContent_startDate');
    if (dateEl && session.starts_at) {
      var d = new Date(session.starts_at);
      dateEl.value = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
    }

    // Start time — <input type="time"> expects HH:mm in 24-hour format
    var startTimeEl = document.getElementById('mainContent_startTime');
    if (startTimeEl && session.starts_at) {
      var sd = new Date(session.starts_at);
      startTimeEl.value =
        pad2(sd.getUTCHours()) + ':' + pad2(sd.getUTCMinutes());
    }

    // End time
    var endTimeEl = document.getElementById('mainContent_endTime');
    if (endTimeEl && session.ends_at) {
      var ed = new Date(session.ends_at);
      endTimeEl.value =
        pad2(ed.getUTCHours()) + ':' + pad2(ed.getUTCMinutes());
    }

    // Price — written through the postback guard, not directly. See installPriceGuard.
    // This must run before the assistant field below, whose change event triggers
    // an UpdatePanel postback that would otherwise wipe a plain write.
    installPriceGuard(session);

    // Total Hours — class type default plus any per-session additional hours
    var hoursEl = document.getElementById('mainContent_totalHours');
    if (hoursEl && session.class_type && session.class_type.duration_minutes) {
      var additionalHours = session.additional_hours || 0;
      var hrs = (session.class_type.duration_minutes / 60) + additionalHours;
      // Show as integer if whole, otherwise one decimal place (e.g. 1.5)
      hoursEl.value = (hrs % 1 === 0) ? String(hrs) : hrs.toFixed(1);
    }

    // Max Students
    var maxEl = document.getElementById('mainContent_maxEnrollment');
    if (maxEl && session.max_capacity) {
      maxEl.value = String(session.max_capacity);
    }

    // Assistant — Enrollware renders this as a BsmSelect jQuery widget.
    // The visible <select> has id="bsmSelectbsmContainer0". Unlike the other
    // dropdowns, BsmSelect does not respond to a plain .value assignment — a
    // change event must be fired so the plugin updates its hidden input.
    var assistantEl = document.getElementById('bsmSelectbsmContainer0');
    if (assistantEl) {
      var assistantName = session.assistant_name ||
        (session.assistant_instructor
          ? session.assistant_instructor.first_name + ' ' + session.assistant_instructor.last_name
          : null);
      if (assistantName) {
        if (selectByName(assistantEl, assistantName)) {
          assistantEl.dispatchEvent(new Event('change'));
        } else {
          warnings.push('Could not match assistant: "' + assistantName + '"');
        }
      }
    }

    return warnings;
  }

  /** Pads a number to two digits with a leading zero if needed. */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // =========================================================
  // Student XLSX fetch and injection
  // =========================================================

  /**
   * Fetches a pre-built .xlsx roster from the SuperheroCPR API for the given
   * session. The server generates the workbook in memory — nothing is stored.
   * Returns a Promise that resolves to the raw Blob.
   */
  function fetchStudentXLSX(sessionId) {
    return fetch(
      API_BASE + '/api/enrollware/student-xlsx?sessionId=' + encodeURIComponent(sessionId),
      { headers: { 'Authorization': 'Bearer ' + __k } }
    ).then(function(r) {
      if (!r.ok) {
        return r.json().then(function(data) {
          throw new Error(data.error || ('API error ' + r.status));
        });
      }
      return r.blob();
    });
  }

  /**
   * Injects an xlsx Blob into Enrollware's file import input using a DataTransfer
   * object, then makes the import panel visible. Returns true if successful.
   * Falls back gracefully if DataTransfer is not available (some older browsers).
   */
  function injectStudentFile(blob) {
    var fileInput = document.getElementById('mainContent_impFileUpl');
    if (!fileInput) return false;

    try {
      var file = new File(
        [blob],
        'students.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      var dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    } catch (e) {
      return false;
    }

    // Make sure the import panel is visible (it may be collapsed by default)
    var importPanel = document.getElementById('mainContent_importPnl');
    if (importPanel) importPanel.style.display = 'block';

    return true;
  }

  // =========================================================
  // Floating panel UI
  // =========================================================

  var _panel = null;

  /** Creates or updates the floating overlay panel with the given HTML content. */
  function showPanel(html) {
    if (!_panel) {
      _panel = document.createElement('div');
      _panel.id = 'scpr-enrw-panel';
      _panel.style.cssText = [
        'position:fixed', 'top:80px', 'right:20px', 'z-index:2147483647',
        'background:#fff', 'border:2px solid #c8102e', 'border-radius:8px',
        'padding:16px', 'max-width:320px', 'min-width:240px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
        'font-family:Arial,Helvetica,sans-serif',
        'font-size:13px', 'color:#333',
        'max-height:80vh', 'overflow-y:auto',
        'line-height:1.4'
      ].join(';');
      document.body.appendChild(_panel);
    }
    _panel.innerHTML = html;
  }

  /** Removes the overlay panel from the DOM. */
  function closePanel() {
    if (_panel) { _panel.remove(); _panel = null; }
  }

  /** Standard panel header with title and close button. */
  function panelHeader() {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
           '<b style="color:#c8102e;font-size:14px">&#x1F9B8; SuperheroCPR</b>' +
           '<button onclick="(function(){var p=document.getElementById(\\'scpr-enrw-panel\\');if(p)p.remove();window.__SCPR_LOADED=false;})()" ' +
           'style="border:none;background:none;cursor:pointer;font-size:18px;line-height:1;color:#666">&times;</button>' +
           '</div>';
  }

  function showLoading() {
    showPanel(panelHeader() + '<div style="text-align:center;padding:8px 0;color:#666">Loading classes&hellip;</div>');
  }

  function showError(msg) {
    showPanel(panelHeader() + '<div style="color:#c8102e;font-size:12px">' + msg + '</div>');
  }

  // =========================================================
  // Class picker — new-class mode
  // =========================================================

  function showClassPicker(classes) {
    var items = classes.map(function(c, idx) {
      var start = new Date(c.starts_at);
      var timeStr = start.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
      var count = c.students ? c.students.length : 0;
      var submitted = c.enrollware_submitted
        ? '<span style="color:#888;font-size:11px"> &#x2713; submitted</span>'
        : '';
      return '<div style="border:1px solid #ddd;border-radius:4px;padding:8px;' +
             'margin-bottom:8px;cursor:pointer;transition:background 0.1s" ' +
             'onmouseover="this.style.background=\\'#f9f9f9\\'" ' +
             'onmouseout="this.style.background=\\'#fff\\'" ' +
             'onclick="window.__SCPR_PICK(' + idx + ')">'  +
             '<b style="font-size:13px">' + (c.class_type ? c.class_type.name : 'Unknown Course') + '</b>' + submitted + '<br>' +
             '<span style="color:#555;font-size:12px">' + timeStr + ' &middot; ' + (c.location ? c.location.name : 'No location') + '</span><br>' +
             '<span style="color:#888;font-size:11px">' + count + ' student' + (count !== 1 ? 's' : '') + ' in database</span>' +
             '</div>';
    }).join('');

    var empty = classes.length === 0
      ? '<div style="color:#666;font-size:12px">No classes found for today.<br>Check the SuperheroCPR admin if this looks wrong.</div>'
      : '';

    showPanel(panelHeader() +
      '<div style="font-size:12px;color:#666;margin-bottom:10px">Select the class to fill:</div>' +
      items + empty
    );

    window.__SCPR_PICK = function(idx) {
      var session = classes[idx];
      // Store the selected session ID in sessionStorage so it survives the
      // page reload that happens after "Update Class" is clicked.
      sessionStorage.setItem('scpr_session_id', session.id);
      // Store the full class data so the student fill doesn't need another API call
      sessionStorage.setItem('scpr_session_data', JSON.stringify(session));

      var warnings = fillClassForm(session);

      var warnHtml = '';
      if (warnings.length > 0) {
        warnHtml = '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;' +
                   'padding:8px;margin-top:8px;font-size:11px;color:#856404">' +
                   '&#9888; ' + warnings.join('<br>') + '</div>';
      }

      showPanel(panelHeader() +
        '<div style="color:#2d7a2d;margin-bottom:6px">&#x2713; Class fields filled!</div>' +
        '<div style="font-size:12px;color:#555;margin-bottom:8px">' +
        'Review the fields, then click <b>Update Class</b>.<br>' +
        'Student data will load automatically once the page updates.' +
        '</div>' +
        warnHtml +
        '<button onclick="window.__SCPR_WATCH()" ' +
        'style="width:100%;margin-top:10px;padding:7px;background:#c8102e;color:#fff;' +
        'border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold">' +
        '&#x2713; Got it &mdash; watching for student list' +
        '</button>'
      );

      // Start watching immediately in case the user already clicked Update Class
      window.__SCPR_WATCH();
    };

    window.__SCPR_WATCH = function() {
      // Watch for Enrollware's UpdatePanel to render the student list section
      // after "Update Class" triggers an AJAX postback. We scope the observer
      // to the form container (not document.body) and skip attribute mutations
      // — Enrollware pages fire thousands of attribute changes per second and
      // observing them all locks up the browser.
      var watchTarget = document.querySelector('form') || document.body;
      var fired = false;

      var observer = new MutationObserver(function() {
        if (fired) return;
        var studentPanel = document.getElementById('mainContent_studentPanel');
        if (studentPanel && studentPanel.offsetHeight > 0) {
          fired = true;
          observer.disconnect();
          if (window.__SCPR_WATCH_TIMEOUT) {
            clearTimeout(window.__SCPR_WATCH_TIMEOUT);
            window.__SCPR_WATCH_TIMEOUT = null;
          }
          var storedData = sessionStorage.getItem('scpr_session_data');
          if (storedData) {
            try {
              var session = JSON.parse(storedData);
              setTimeout(function() { showStudentFill(session); }, 400);
            } catch (e) { /* ignore parse error */ }
          }
        }
      });
      observer.observe(watchTarget, { childList: true, subtree: true });

      // Safety: give up after 2 minutes so the observer doesn't run forever
      // if the instructor never clicks Update Class.
      window.__SCPR_WATCH_TIMEOUT = setTimeout(function() {
        if (!fired) observer.disconnect();
      }, 120000);

      closePanel();
    };
  }

  // =========================================================
  // Student fill — existing-class mode
  // =========================================================

  function showStudentFill(session) {
    var students = session.students || [];

    // Price — install the guard before the Import button is clicked below, since
    // that click fires an UpdatePanel postback that replaces the price input.
    installPriceGuard(session);

    // Fill "Certificate Issued On" from the session date. This field only exists
    // on existing-class pages (not new-class forms), so the null check is normal.
    // starts_at is a floating wall-clock value — slice(0,10) gives YYYY-MM-DD
    // verbatim with no timezone conversion, matching the date input's expected format.
    var issueDateEl = document.getElementById('mainContent_issueDate');
    if (issueDateEl && session.starts_at) {
      issueDateEl.value = session.starts_at.slice(0, 10);
    }

    if (students.length === 0) {
      showPanel(panelHeader() +
        '<div style="font-size:13px">No students found in the database for this class.</div>' +
        '<div style="font-size:11px;color:#666;margin-top:6px">Students can be added manually using the form above.</div>'
      );
      return;
    }

    var count = students.length;
    showPanel(panelHeader() +
      '<div style="text-align:center;padding:8px 0;color:#666">Preparing student file&hellip;</div>'
    );

    // Fetch the XLSX blob and open the import panel in parallel so we can
    // inject the file as soon as both are ready, minimising total wait time.
    //
    // mainContent_importBtn is an ASP.NET UpdatePanel submit button — clicking
    // it triggers an async partial-postback that reveals mainContent_impFileUpl
    // (the file input) without a full page reload. We click it and wait for the
    // element to appear via MutationObserver rather than polling.
    var blobPromise = fetchStudentXLSX(session.id);

    var fileReadyPromise = new Promise(function(resolve) {
      if (document.getElementById('mainContent_impFileUpl')) { resolve(true); return; }
      var importBtn = document.getElementById('mainContent_importBtn');
      if (!importBtn) { resolve(false); return; }
      var done = false;
      var observer = new MutationObserver(function() {
        if (done) return;
        if (document.getElementById('mainContent_impFileUpl')) {
          done = true;
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function() {
        if (!done) { done = true; observer.disconnect(); resolve(false); }
      }, 10000);
      importBtn.click();
    });

    Promise.all([blobPromise, fileReadyPromise]).then(function(results) {
      var blob = results[0];
      var injected = injectStudentFile(blob);

      showPanel(panelHeader() +
        (injected
          ? '<div style="color:#2d7a2d;margin-bottom:6px">&#x2713; ' + count + ' student' + (count !== 1 ? 's' : '') + ' loaded into the import file!</div>' +
            '<div style="font-size:12px;color:#555;margin-bottom:10px">Click <b>Import Students</b> to add them to this class.</div>'
          : '<div style="color:#c8102e;margin-bottom:8px">&#9888; Could not inject file automatically. Use the download button below.</div>'
        ) +
        '<button onclick="window.__SCPR_DOWNLOAD()" ' +
        'style="width:100%;padding:6px;background:#444;color:#fff;border:none;' +
        'border-radius:4px;cursor:pointer;font-size:12px;margin-bottom:6px">' +
        '&#x2193; Download student file (.xlsx)' +
        '</button>' +
        '<button onclick="window.__SCPR_MARK_DONE(\\\'' + session.id + '\\\')" ' +
        'style="width:100%;padding:6px;background:#c8102e;color:#fff;border:none;' +
        'border-radius:4px;cursor:pointer;font-size:12px">' +
        '&#x2713; Mark class as submitted' +
        '</button>'
      );

      window.__SCPR_DOWNLOAD = function() {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'students.xlsx'; a.click();
        URL.revokeObjectURL(url);
      };

      // "Mark class as submitted" does two things: records the submission in
      // SuperheroCPR, and — if the file was auto-injected — clicks Enrollware's
      // own "Import Students" button so the instructor doesn't have to do it
      // separately. mainContent_impUploadBtn is a full-page form submit (it is in
      // PageRequestManager._postBackControlIDs, not the async list, confirmed on
      // the live site), so the browser navigates away as soon as it's clicked —
      // our own markSubmitted() call must finish first, or the fetch to our API
      // can be aborted by the navigation.
      window.__SCPR_MARK_DONE = function(id) {
        showPanel(panelHeader() +
          '<div style="text-align:center;padding:8px 0;color:#666">Submitting&hellip;</div>'
        );
        markSubmitted(id).then(function() {
          sessionStorage.removeItem('scpr_session_id');
          sessionStorage.removeItem('scpr_session_data');

          var uploadBtn = document.getElementById('mainContent_impUploadBtn');
          if (injected && uploadBtn) {
            uploadBtn.click();
            return; // page is navigating away; nothing after this runs
          }

          showPanel(panelHeader() +
            '<div style="color:#2d7a2d">&#x2713; Marked as submitted in SuperheroCPR.</div>' +
            (injected
              ? ''
              : '<div style="font-size:11px;color:#856404;margin-top:8px">' +
                '&#9888; Could not auto-submit the import earlier — click ' +
                '<b>Import Students</b> above to finish.</div>')
          );
        }).catch(function() {
          showError('Failed to mark as submitted. Please update manually in the SuperheroCPR admin.');
        });
      };

    }).catch(function(err) {
      showError('Failed to prepare student file: ' + (err.message || 'Unknown error'));
    });
  }

  // =========================================================
  // Entry point
  // =========================================================

  function run() {
    var mode = getPageMode();

    if (!mode) {
      alert('SuperheroCPR Enrollware Tool:\\nNavigate to a class-edit.aspx page to use this tool.');
      window.__SCPR_LOADED = false;
      return;
    }

    // Restore the price before anything else. "Update Class" and the student
    // Import are full page submits that discard this script, and the page comes
    // back carrying Enrollware's own "$0.00". Re-applying here means the price is
    // already correct by the time the instructor looks at the reloaded page —
    // no waiting on the class list to load, and no dependency on which mode we
    // end up in below.
    installPriceWatcher();
    applyPrice();

    showLoading();

    fetchTodaysClasses().then(function(data) {
      var classes = data.classes || [];

      if (mode === 'existing-class') {
        // Check if the student panel is already visible (page loaded with a class ID)
        var studentPanel = document.getElementById('mainContent_studentPanel');
        var storedId = sessionStorage.getItem('scpr_session_id');

        if (studentPanel && storedId) {
          // Always prefer fresh data from the API — the cached version was fetched
          // before grading, so grades would be null if we used it. Look up the
          // stored session ID in the freshly-fetched classes list.
          var freshSession = null;
          for (var i = 0; i < classes.length; i++) {
            if (classes[i].id === storedId) {
              freshSession = classes[i];
              break;
            }
          }
          if (freshSession) {
            // Refresh the cache so downstream code also has current grades
            sessionStorage.setItem('scpr_session_data', JSON.stringify(freshSession));
            showStudentFill(freshSession);
            return;
          }
          // Stored session not found in today's classes (e.g. different day) —
          // fall through to the manual picker so the instructor can choose
        }

        // Student panel visible but no stored selection — let instructor pick
        if (studentPanel) {
          showClassPickerForStudents(classes);
          return;
        }
      }

      // Default: show the class picker for filling the class form
      showClassPicker(classes);

    }).catch(function(err) {
      showError(err.message || 'Failed to load classes. Check your internet connection.');
    });
  }

  function showClassPickerForStudents(classes) {
    var items = classes.map(function(c, idx) {
      var start = new Date(c.starts_at);
      var timeStr = start.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
      var count = c.students ? c.students.length : 0;
      return '<div style="border:1px solid #ddd;border-radius:4px;padding:8px;' +
             'margin-bottom:8px;cursor:pointer" ' +
             'onmouseover="this.style.background=\\'#f9f9f9\\'" ' +
             'onmouseout="this.style.background=\\'#fff\\'" ' +
             'onclick="window.__SCPR_PICK_STUDENTS(' + idx + ')">'  +
             '<b>' + (c.class_type ? c.class_type.name : 'Unknown') + '</b><br>' +
             '<span style="color:#555;font-size:12px">' + timeStr + ' &middot; ' + (c.location ? c.location.name : '') + '</span><br>' +
             '<span style="color:#888;font-size:11px">' + count + ' student' + (count !== 1 ? 's' : '') + '</span>' +
             '</div>';
    }).join('');

    showPanel(panelHeader() +
      '<div style="font-size:12px;color:#666;margin-bottom:10px">Which class are you adding students for?</div>' +
      items
    );

    window.__SCPR_PICK_STUDENTS = function(idx) {
      var session = classes[idx];
      sessionStorage.setItem('scpr_session_id', session.id);
      sessionStorage.setItem('scpr_session_data', JSON.stringify(session));
      showStudentFill(session);
    };
  }

  // Expose show() so a second tap re-opens the panel without re-fetching
  window.__SCPR_SHOW = run;

  run();

})();
`.trim();
}

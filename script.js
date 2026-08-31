/* ============================================================
   script.js
   Application shell: state, filter plumbing, event wiring, mode
   switching and the MyGeotab Add-In lifecycle.

   Rendering lives in overview.js / operations.js / maintenance.js;
   derivations in calc.js; the asset drawer in drawer.js; the filter
   chips and advanced panel in filters.js; CSV builders in exports.js.
   ============================================================ */
window.OCC = window.OCC || {};

(function (OCC) {
  "use strict";

  var ui, calc, ds, icons;

  var TABS = ["overview", "operations", "maintenance", "safety"];

  /* The global context (core/context.js): group selection, filters,
     units, quiet threshold, activity range, register sort. Every change
     goes through C.set / C.setFilters and re-renders via the single
     subscriber below - there is no second copy anywhere. */
  var C = OCC.context;

  /* Shell state: what was loaded and how the load went. Context fields
     are exposed on S as read-only getters so renderers and helpers can
     keep reading S.filters / S.units; writes must go through C. */
  OCC.state = {
    assets: [],          /* every asset, unfiltered */
    filtered: [],
    groups: [],          /* flat tree (display order), for compatibility */
    tree: null,          /* core/group-tree.js instance for this database */
    closure: null,       /* Set of group ids in the current selection, or null = all */
    cameraRaw: { available: false },  /* ZenduONE camera feed, per load (services/camera-service.js) */
    camera: { available: false },     /* ...summarised for the assets on screen, per render */
    routesRaw: { available: false, executions: [] },  /* Plan vs Actual, per load (services/route-service.js) */
    routes: { available: false, executions: [] },     /* ...for the assets on screen, per render */
    dvirRaw: { available: false },                    /* DVIR logs + trips, per load (services/dvir-service.js) */
    dvir: { available: false },                       /* ...compliance for the assets on screen, per render */
    safetyRaw: { available: false, lazy: true },      /* events + rules + trips, loaded on first use of Safety */
    safety: { available: false, lazy: true },         /* ...scores for the assets on screen, per render */
    safetyLoaded: false,
    safetyLoading: false,
    safetyView: "driver",                             /* Safety events grouped by driver | vehicle */
    driver: { available: false },
    zenduone: { state: "idle" },   /* ZenduONE platform session, see api/zenduone-api.js */
    tab: "overview",
    attentionShowAll: false,   /* worklist cap lifted by "Show all" */
    refreshError: null,        /* a failed REFRESH keeps the last good data on screen */
    loading: false,
    error: null,
    warnings: [],
    source: null,        /* "geotab" | "mock" */
    lastUpdated: null,
    lastSuccess: null,   /* survives a failed refresh, for the error state */
    /* First paint should not flash "Updated just now" - there was
       nothing to update FROM. Only a real refresh confirms. */
    firstLoadDone: false
  };

  var S = OCC.state;

  ["filters", "units", "quietAfter", "activityRange", "sortKey", "sortDir"].forEach(function (k) {
    Object.defineProperty(S, k, {
      enumerable: true,
      get: function () { return C.get()[k]; }
    });
  });

  function defaultFilters() {
    return OCC.contextStore.defaultFilters();
  }

  /* The ONE subscriber. Anything that changes the context - a chip, the
     group picker, a site row, a drawer action, a select - lands here. */
  C.subscribe(function () {
    if (!ui) return;                 /* before boot() nothing is wired */
    renderFilterUi();
    render();
  });

  /* ============================================================
     DATA LOAD
     ============================================================ */
  function loadAll() {
    S.loading = true;
    S.error = null;
    S.warnings = [];
    setRefreshBusy(true);
    renderLoading();
    renderBanner();

    /* The ZenduONE session is minted alongside the fleet read, never on
       the critical path: connect() resolves to a status object and does
       not reject, so a platform outage cannot blank the fleet. The
       camera feed needs that session, so it follows it. */
    var zenduoneReady = ds.useMock()
      ? Promise.resolve({ state: "unavailable" })
      : OCC.zenduone.connect();

    return Promise.all([
      ds.fleetService.getFleet(),
      zenduoneReady.then(function () { return ds.cameraHealthService.getCameraHealth(); }),
      /* Driver scoring is derived on the Safety tab (services/safety-service.js),
         loaded lazily because 30 days of trips is the heaviest read. */
      Promise.resolve({ available: false, lazy: true }),
      zenduoneReady,
      /* Warms the ZenduONE device list so the serial join behind
         "Create work order" can be answered synchronously. */
      zenduoneReady.then(function () { return OCC.services.maintenance.warm(); })
    ]).then(function (r) {
      S.groups = r[0].groups;
      S.assets = r[0].assets;
      S.warnings = r[0].warnings || [];
      S.refreshError = null;
      S.source = r[0].source;
      S.cameraRaw = r[1];
      S.camera = ds.cameraHealthService.summarize(S.cameraRaw, S.assets);
      S.driver = r[2];
      S.zenduone = r[3] || { state: "idle" };
      S.tree = r[0].tree || null;

      /* Group ids held over from a previous database (or a stale
         preview) are not in the new tree and would filter everything
         out with no way back. Drop them, then let MyGeotab's own group
         filter seed the context. Both run while loading is still true,
         so the subscriber's render is a no-op until the panels are
         rebuilt below. */
      var known = S.filters.groupIds.filter(groupExists);
      if (known.length !== S.filters.groupIds.length) C.setFilters({ groupIds: known });
      seedGroupContext();

      /* Routes need the fleet (serial join) and the ZenduONE session,
         so they follow both. Never on the critical path: a failure
         becomes an "unavailable" panel, not a blank dashboard. */
      var routes = OCC.services.routes.load(S.assets).then(function (routes) {
        S.routesRaw = routes;
      }, function (err) {
        S.routesRaw = { available: false, reason: (err && err.message) || "Route service failed", executions: [] };
      });
      var dvir = OCC.services.dvir.load(S.assets).then(function (d) {
        S.dvirRaw = d;
      }, function (err) {
        S.dvirRaw = { available: false, reason: (err && err.message) || "Inspection service failed" };
      });
      return Promise.all([routes, dvir]).then(function () { return r; });
    }).then(function (r) {
      S.lastUpdated = r[0].fetchedAt || new Date();
      S.lastSuccess = S.lastUpdated;
      S.loading = false;
      /* Confirm, rather than silently going quiet: a refresh with no
         visible result reads as a refresh that did not happen. */
      setRefreshState(S.firstLoadDone ? "done" : "idle");
      S.firstLoadDone = true;

      /* Fresh fleet: don't tween KPI digits from the previous one. */
      ui.resetKpiMemory();

      rebuildPanels();
      renderBanner();
      renderLiveState();
      /* Stamp "Last update" now rather than on the next second's tick. */
      tickClock();
      renderFilterUi();
      render();
      /* Safety follows a refresh only if it has been used. */
      if (S.safetyLoaded) { S.safetyLoaded = false; loadSafety(); }
    }).catch(function (err) {
      S.loading = false;
      setRefreshState("error");
      var msg = err && err.message ? err.message : "Unable to load fleet data.";

      if (S.assets.length) {
        /* A failed REFRESH keeps the last good numbers on screen and
           says how old they are (banner + Try again). Only a failed
           FIRST load takes the panels over with the error card. */
        S.error = null;
        S.refreshError = msg;
        rebuildPanels();
        renderBanner();
        renderLiveState();
        render();
        return;
      }

      S.error = msg;
      renderError();
      renderBanner();
      renderLiveState();
    });
  }

  function groupExists(id) {
    return !!(S.tree && S.tree.has(id));
  }

  /* ============================================================
     GROUP CONTEXT
     ============================================================ */
  var lastGeotabSeed = null;

  /* MyGeotab's own group filter (top of its page) seeds ours, so the
     Add-In extends the shell's selection instead of competing with it.
     Applied only when the shell's filter CHANGES, so an operator who
     narrows further inside the Add-In is not overridden on every focus.
     MyGeotab reports the company root when no filter is applied; that
     is "all groups" here. */
  function seedGroupContext() {
    if (!S.tree) return;
    var ids = OCC.geotabApi.getGroupFilter();
    var key = ids.slice().sort().join("|");
    if (key === lastGeotabSeed) return;
    lastGeotabSeed = key;
    var known = ids.filter(groupExists);
    C.setFilters({ groupIds: S.tree.isRootSelection(known) ? [] : known });
  }

  /* Select exactly these groups; selecting the current selection again
     steps back out to all groups (site rows and drawer actions toggle). */
  function selectGroups(ids) {
    ids = (ids || []).filter(Boolean);
    var cur = S.filters.groupIds;
    var same = cur.length === ids.length &&
               ids.every(function (id) { return cur.indexOf(id) !== -1; });
    C.setFilters({ groupIds: same ? [] : ids });
  }

  function pickerOpts() {
    return {
      tree: S.tree,
      counts: S.tree ? S.tree.counts(S.assets) : null,
      selected: S.filters.groupIds
    };
  }

  function renderGroupTrigger() {
    if (!OCC.groupPicker) return;
    var inSelection = S.closure && S.tree
      ? S.assets.filter(function (a) { return S.tree.assetInClosure(a, S.closure); }).length
      : S.assets.length;
    OCC.groupPicker.renderTrigger({
      tree: S.tree, selected: S.filters.groupIds, inSelection: inSelection
    });
    OCC.groupPicker.update(pickerOpts());
  }

  /* ============================================================
     FILTERS
     ============================================================ */
  function filterMeta() {
    return OCC.filters.buildMeta(S);
  }

  function renderFilterUi() {
    OCC.filters.renderChips(S.filters, filterMeta());
    /* Keep an open advanced panel in sync - its selects show the live
       filter values, and its option lists narrow with the group. */
    if (OCC.filters.isPanelOpen()) OCC.filters.renderPanel(S, filterMeta());
  }

  /* Removing one chip. The reset value comes from calc so the chip and
     the predicate cannot disagree about what "off" means. */
  function clearOneFilter(key) {
    var list = calc.activeFilterList(S.filters, filterMeta());
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) {
        var patch = {};
        patch[key] = list[i].reset;
        C.setFilters(patch);
        break;
      }
    }
    if (key === "search") {
      var input = ui.$("occ-f-search");
      if (input) input.value = "";
      renderSearchAffordances();
    }
  }

  function clearAllFilters() {
    var input = ui.$("occ-f-search");
    if (input) input.value = "";
    renderSearchAffordances();
    C.resetFilters();
  }

  /* ============================================================
     CHROME
     ============================================================ */
  /* Header, modes and filter bar live OUTSIDE the tab panels, so they
     survive rebuildPanels() and only need painting once.

     Keeping this separate from paintPanelChrome() is not tidiness: the
     refresh icon is in here, and repainting it mid-load replaced the
     very <svg> that setRefreshBusy() had just marked as spinning, so
     the spinner never appeared. */
  function paintStaticChrome() {
    ui.$("occ-brandmark").innerHTML = icons.svg("truck-solid", { size: 19 });
    ui.$("occ-refresh-icon").innerHTML = icons.svg("refresh", { size: 13 });
    ui.$("occ-filter-icon").innerHTML = icons.svg("filter", { size: 13 });
    ui.$("occ-search-icon").innerHTML = icons.svg("search", { size: 13 });
    ui.$("occ-filter-add-icon").innerHTML = icons.svg("plus", { size: 12 });
    ui.$("occ-search-clear").innerHTML = icons.svg("close", { size: 11, stroke: 2.2 });

    var tabIcons = { overview: "heart", operations: "activity", maintenance: "wrench", safety: "user" };
    Array.prototype.forEach.call(
      document.querySelectorAll("#occ-root .occ-tab"),
      function (b) {
        var slot = b.querySelector(".occ-tab-icon");
        if (slot) slot.innerHTML = icons.svg(tabIcons[b.getAttribute("data-tab")], { size: 14 });
      }
    );
  }

  /* Export icons sit inside the panels, so they are lost whenever the
     panel markup is restored and must be repainted with it. */
  function paintPanelChrome() {
    Array.prototype.forEach.call(
      document.querySelectorAll("#occ-root .occ-export-icon"),
      function (slot) { slot.innerHTML = icons.svg("download", { size: 11 }); }
    );
  }

  /* ---- Refresh state machine ---------------------------------------
     The control reports what the system is doing rather than just
     offering to do it: idle names when the data landed, in-flight says
     so, and success confirms for a beat before settling back. The
     button is fixed-width in CSS so none of that reflows the rail.

     `done` deliberately does NOT persist - a permanent green tick is
     indistinguishable from a stale one four minutes later. */
  var doneTimer = null;

  /* Below `sm` the refresh button drops its two lines of text and
     becomes a square glyph, so the reading has to survive somewhere a
     screen reader and a tooltip can both reach. */
  function syncRefreshLabel() {
    var btn = ui.$("occ-refresh");
    var title = ui.$("occ-refresh-title");
    var sub = ui.$("occ-refresh-sub");
    if (!btn || !title || !sub) return;
    var label = title.textContent + ", " + sub.textContent;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }

  function setRefreshState(state) {
    var btn = ui.$("occ-refresh");
    var icon = ui.$("occ-refresh-icon");
    var title = ui.$("occ-refresh-title");
    var sub = ui.$("occ-refresh-sub");
    if (!btn || !icon || !title || !sub) return;

    var busy = state === "busy";
    btn.disabled = busy;
    btn.classList.toggle("opacity-60", busy);
    btn.classList.toggle("is-done", state === "done");
    btn.setAttribute("aria-busy", busy ? "true" : "false");

    clearTimeout(doneTimer);

    if (busy) {
      icon.innerHTML = icons.svg("refresh", { size: 13 });
      var svg = icon.querySelector("svg");
      if (svg) svg.classList.add("occ-spin");
      title.textContent = "Updating…";
      sub.textContent = "Fetching fleet data";
      return syncRefreshLabel();
    }

    if (state === "done") {
      icon.innerHTML = icons.svg("check", { size: 13, stroke: 2 });
      title.textContent = "Updated";
      sub.textContent = "just now";
      /* Settle back to the idle reading, which then keeps ageing with
         the clock tick. */
      doneTimer = setTimeout(function () { setRefreshState("idle"); }, 4000);
      return syncRefreshLabel();
    }

    if (state === "error") {
      icon.innerHTML = icons.svg("alert", { size: 13, stroke: 2 });
      title.textContent = "Retry";
      sub.textContent = "Update failed";
      return syncRefreshLabel();
    }

    icon.innerHTML = icons.svg("refresh", { size: 13 });
    title.textContent = "Refresh";
    sub.textContent = S.lastUpdated
      ? "Updated " + ui.fmtAgo(S.lastUpdated)
      : "Not loaded yet";
    syncRefreshLabel();
  }

  /* Kept as the old name so nothing downstream had to change. */
  function setRefreshBusy(busy) {
    setRefreshState(busy ? "busy" : "idle");
  }

  /* The connection lamp and the word beside it. Reflects the ACTUAL
     source - a pulsing "LIVE" chip over sample data would be a lie, so
     the animation is only ever attached on a real session. */
  function renderLiveState() {
    var chip = ui.$("occ-livestate");
    var dot = chip && chip.querySelector(".occ-livedot");
    var word = ui.$("occ-source-word");
    if (!chip || !dot || !word) return;

    var live = S.source === "geotab";
    var state = live ? "live" : S.source === "mock" ? "preview" : "unknown";

    dot.classList.toggle("is-live", live);
    dot.classList.toggle("is-preview", S.source === "mock");
    word.textContent = S.source ? (live ? "Live" : "Preview") : "—";

    /* The state goes on the ELEMENT and CSS owns the colour. This used
       to assign word.className, which meant the chip's own styling was
       destroyed on every render - the exact bug that makes a themed
       component silently revert to unstyled text. */
    chip.setAttribute("data-state", state);
    chip.setAttribute("title", live
      ? "Connected to this MyGeotab session"
      : state === "preview"
        ? "Showing generated sample data, not your fleet"
        : "No data source yet");
  }

  /* ---- Fleet vitals -------------------------------------------------
     The three numbers the system bar answers with. Computed from
     S.filtered - the SAME set the panels below are drawing - so the
     header can never disagree with the dashboard under it.

     Alerts is CRITICAL faults, not critical + warning: an alert count
     that includes the things nobody has to act on tonight is a count
     an operator learns to ignore. The warning total rides along in the
     tooltip, and the Overview hero states both in full.

     It is also the only one of the three that is a button, because it
     is the only one that implies an action - and it goes disabled at
     zero rather than staying clickable with nothing to show. */
  function renderHeaderVitals() {
    var h = calc.fleetHealth(S.filtered);

    var fleet = ui.$("occ-vital-fleet");
    if (fleet) {
      fleet.textContent = h.total && typeof h.operationalPct === "number"
        ? Math.round(h.operationalPct) + "%"
        : ui.DASH;
    }

    var assets = ui.$("occ-vital-assets");
    if (assets) assets.textContent = ui.fmtNumber(h.total);

    var crit = h.criticalFaults;
    var btn = ui.$("occ-vital-alerts");
    var val = ui.$("occ-vital-alerts-value");

    if (btn && val) {
      var plural = crit === 1 ? "" : "s";
      val.textContent = ui.fmtNumber(crit);
      btn.classList.toggle("is-crit", crit > 0);
      btn.disabled = crit === 0;
      btn.setAttribute("aria-label", crit
        ? crit + " critical fault" + plural + ". Show them on the fault board"
        : "No critical faults");
      btn.setAttribute("title", crit
        ? "Show the " + crit + " critical fault" + plural + " on the fault board" +
          (h.warningFaults ? " (" + h.warningFaults + " warnings too)" : "")
        : h.warningFaults
          ? "No critical faults (" + h.warningFaults + " warnings)"
          : "No faults");
    }

    /* Section badge. Hidden at zero - a badge that is always there is
       furniture, not a signal. */
    var badge = ui.$("occ-tab-badge-maintenance");
    if (badge) {
      badge.textContent = crit > 99 ? "99+" : String(crit);
      badge.hidden = crit === 0;
      badge.setAttribute("aria-label", crit + " critical fault" +
        (crit === 1 ? "" : "s"));
    }
  }

  /* The search box's two corner affordances. They share one corner, so
     exactly one of them is ever present: the shortcut hint until there
     is something to clear, the clear button after. */
  function renderSearchAffordances() {
    var wrap = ui.$("occ-search");
    var input = ui.$("occ-f-search");
    var clear = ui.$("occ-search-clear");
    if (!wrap || !input) return;
    var has = !!input.value;
    wrap.classList.toggle("has-value", has);
    if (clear) clear.hidden = !has;
  }

  /* ---- Live clock ---------------------------------------------------
     A control room clock without a moving digit is indistinguishable
     from a screenshot, and the same tick ages every "updated N ago"
     readout on the page - so freshness is never something the operator
     has to work out from a timestamp.

     Paused while the Add-In is blurred or the browser tab is hidden:
     there is nobody reading it, and an Add-In should not keep a timer
     alive in MyGeotab's page for a panel that is not on screen. */
  var clockTimer = null;

  function tickClock() {
    /* The console readout is WHEN the numbers were fetched, not the
       time of day: freshness is the fact an operator needs. */
    var clock = ui.$("occ-clock");
    if (clock) clock.textContent = ui.fmtClock12(S.lastUpdated);

    if (S.lastUpdated) {
      var ago = ui.fmtAgo(S.lastUpdated);
      Array.prototype.forEach.call(
        document.querySelectorAll('#occ-root [data-live="ago"]'),
        function (el) { el.textContent = ago; }
      );
      /* Only when idle: overwriting the sub-line mid-load would erase
         "Fetching fleet data" a second after it appeared. */
      var title = ui.$("occ-refresh-title");
      var sub = ui.$("occ-refresh-sub");
      if (title && sub && title.textContent === "Refresh") {
        sub.textContent = "Updated " + ago;
        syncRefreshLabel();
      }
    }
  }

  function startClock() {
    if (clockTimer) return;
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
  }

  function stopClock() {
    if (!clockTimer) return;
    clearInterval(clockTimer);
    clockTimer = null;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  /* Skeletons rather than a bare spinner, so the panels keep their
     shape and the layout does not jump when data lands. */
  function renderLoading() {
    rebuildPanels();
    OCC.overview.renderSkeleton();
    OCC.operations.renderSkeleton();
    OCC.maintenance.renderSkeleton();
    OCC.safety.renderSkeleton();
  }

  function renderError() {
    var target = "occ-panel-" + S.tab;
    var el = ui.$(target);
    if (!el) return;

    /* Naming the last good update tells an operator whether the numbers
       they were looking at a minute ago are still worth trusting. */
    var suffix = S.lastSuccess
      ? "Last successful update " + ui.fmtTime(S.lastSuccess) + "."
      : "";

    el.innerHTML = '<div class="occ-card">' +
      ui.errorState(S.error + (suffix ? " " + suffix : ""), "occ-retry") + "</div>";

    var retry = ui.$("occ-retry");
    if (retry) retry.addEventListener("click", function () { rebuildPanels(); loadAll(); });
  }

  /* Preview notice and feed warnings share one strip. Warnings win the
     amber treatment - a missing permission is more urgent than the fact
     that the numbers are samples. */
  function renderBanner() {
    var host = ui.$("occ-banner");
    if (!host) return;

    var html = "";
    if (S.refreshError && S.lastSuccess) {
      html += ui.banner("warn", [
        "Latest refresh failed — " + S.refreshError + " Showing data from " +
        ui.fmtClock12(S.lastSuccess) + "."
      ], {
        action: '<button type="button" class="occ-btn" id="occ-retry-banner">' +
                  icons.svg("refresh", { size: 11 }) + "Try again</button>"
      });
    }
    if (S.warnings.length) {
      html += ui.banner("warn", S.warnings);
    }
    if (S.source === "mock") {
      html += ui.banner("preview", [
        "Preview mode — showing sample data. The Add-In is not connected " +
        "to a MyGeotab session, so no fleet numbers here are real."
      ]);
    }
    host.innerHTML = html;
  }

  /* Panels are static markup that the renderers fill; loading and error
     states replace them wholesale, so restore them before re-rendering. */
  var MARKUP = {};

  function captureMarkup() {
    TABS.forEach(function (t) {
      MARKUP[t] = ui.$("occ-panel-" + t).innerHTML;
    });
  }

  function rebuildPanels() {
    TABS.forEach(function (t) {
      ui.$("occ-panel-" + t).innerHTML = MARKUP[t];
    });
    paintPanelChrome();
  }

  /* The context every renderer, the drawer and every export reads, so
     nothing on screen can disagree with anything else.

     allAssets is the UNFILTERED list: the drawer must still resolve an
     asset that the current filters exclude, or investigating an item
     and then narrowing the filter would blank the drawer. */
  function context() {
    return {
      assets: S.filtered,
      allAssets: S.assets,
      camera: S.camera,
      driver: S.driver,
      filters: S.filters,
      units: S.units,
      sortKey: S.sortKey,
      sortDir: S.sortDir,
      activityRange: S.activityRange,
      /* The System Signal panel reports on the FEEDS, so it needs to
         know which one it is reading and how old the reading is. */
      source: S.source,
      lastUpdated: S.lastUpdated,
      zenduone: S.zenduone,
      /* The group context, for anything that needs more than the
         pre-filtered list (site tables, the picker, exports' filenames). */
      tree: S.tree,
      closure: S.closure,
      groupIds: S.filters.groupIds,
      attentionShowAll: S.attentionShowAll,
      routes: S.routes,
      dvir: S.dvir,
      safety: S.safety,
      /* The RAW safety records too: the drawer needs the individual
         exception events and trips behind the scores (driver detail,
         merged asset timeline), which the summarised view drops. */
      safetyRaw: S.safetyRaw,
      safetyView: S.safetyView,
      /* Incidents other modules contribute to the worklist (core/rank.js). */
      extraIssues: extraIssuesFor
    };
  }

  /* Safety data is fetched the first time the tab is shown (and again
     after a refresh if it had been shown), never on the initial load. */
  function loadSafety() {
    if (S.safetyLoading || !S.assets.length) return;
    S.safetyLoading = true;
    OCC.safety.renderSkeleton();
    OCC.services.safety.load(S.assets).then(function (raw) {
      S.safetyRaw = raw || { available: false, reason: "Safety service returned nothing" };
      S.safetyLoaded = true;
      S.safetyLoading = false;
      if (raw && raw.warnings && raw.warnings.length) {
        S.warnings = S.warnings.concat(raw.warnings);
        renderBanner();
      }
      render();
    }, function (err) {
      S.safetyRaw = { available: false, reason: (err && err.message) || "Safety service failed" };
      S.safetyLoaded = true;
      S.safetyLoading = false;
      render();
    });
  }

  /* DVIR findings as worklist incidents: a vehicle its latest inspection
     says is not safe to operate is CRITICAL; open defects are a WARNING;
     a missed inspection is informational. */
  function extraIssuesFor(a) {
    var d = S.dvir && S.dvir.available ? S.dvir.perAsset[a.id] : null;
    if (!d) return [];
    var out = [];
    if (d.down) {
      out.push({ kind: "dvir", severity: "critical", title: "Not safe to operate",
                 detail: "Latest driver inspection failed",
                 since: d.latestLog ? d.latestLog.dateTime : null, kindLabel: "Inspection" });
    }
    if (d.openDefects) {
      var mine = S.dvir.defects.filter(function (x) { return x.assetId === a.id; });
      out.push({ kind: "dvir", severity: "warning",
                 title: d.openDefects + " open DVIR defect" + (d.openDefects === 1 ? "" : "s"),
                 detail: mine.length ? mine.map(function (x) { return x.defect; }).slice(0, 2).join(", ") +
                         (mine.length > 2 ? " +" + (mine.length - 2) : "") : "Reported on inspection, no repair recorded",
                 since: mine.length ? new Date(mine[0].since) : null, kindLabel: "Inspection" });
    }
    if (d.overdue) {
      out.push({ kind: "dvir", severity: "info", title: "DVIR overdue",
                 detail: d.overdue + " missed inspection" + (d.overdue === 1 ? "" : "s") + " in the last " +
                         S.dvir.window.days + " days",
                 since: d.missingDays.length ? new Date(d.missingDays[0] + "T12:00:00") : null,
                 kindLabel: "Inspection" });
    }
    return out;
  }

  function render() {
    if (S.loading || S.error) return;

    /* Group selection -> closure -> predicate, once per render. The
       site of every asset is re-stamped for this selection (the child of
       the selected group that contains it) before anything reads it. */
    var f = S.filters;
    S.closure = S.tree ? S.tree.closure(f.groupIds) : null;
    var inGroup = S.closure && S.tree
      ? function (a) { return S.tree.assetInClosure(a, S.closure); }
      : null;
    ds.fleetService.resite(S.assets, S.tree ? S.tree.siteResolver(f.groupIds) : null);
    S.filtered = calc.applyFilters(S.assets, f, inGroup);
    /* Camera counts and route executions follow the selection, like
       every other number. */
    S.camera = ds.cameraHealthService.summarize(S.cameraRaw, S.filtered);
    S.routes = OCC.services.routes.select(S.routesRaw, S.filtered, !S.closure);
    S.dvir = OCC.services.dvir.select(S.dvirRaw, S.filtered,
      S.tree ? S.tree.siteResolver(f.groupIds) : null);
    S.safety = OCC.services.safety.select(S.safetyRaw, S.filtered);
    /* The "Driver scoring" feed row: derived once Safety has loaded. */
    S.driver = S.safety.available
      ? { available: true, derived: true, events: S.safety.totalEvents }
      : { available: false, lazy: !S.safetyLoaded && !(S.safetyRaw && S.safetyRaw.reason) };
    var ctx = context();

    renderGroupTrigger();
    renderHeaderVitals();

    /* A live region, so only write when the sentence actually changed:
       re-assigning the same text on every render makes a screen reader
       repeat "94 assets" at every keystroke of a search. */
    var countEl = ui.$("occ-result-count");
    if (countEl) {
      var countText = S.filtered.length === S.assets.length
        ? S.assets.length + " assets"
        : S.filtered.length + " of " + S.assets.length + " assets";
      if (countEl.textContent !== countText) countEl.textContent = countText;
    }

    if (S.tab === "overview") OCC.overview.render(ctx);
    else if (S.tab === "operations") OCC.operations.render(ctx);
    else if (S.tab === "maintenance") OCC.maintenance.render(ctx);
    else if (S.safetyLoading) OCC.safety.renderSkeleton();
    else OCC.safety.render(ctx);

    /* An open drawer must not show stale numbers after a filter change
       or a refresh. */
    OCC.drawer.refresh(ctx);
  }

  /* Retriggers the panel entrance animation. Removing the class,
     forcing a reflow and re-adding it is the only reliable way to
     restart a CSS animation on an element that already has it. */
  function playPanelEnter(el) {
    if (!el || ui.prefersReducedMotion()) return;
    el.classList.remove("occ-panel-enter");
    void el.offsetWidth;
    el.classList.add("occ-panel-enter");
  }

  function setTab(tab, silent) {
    if (TABS.indexOf(tab) === -1) return;
    S.tab = tab;
    if (tab === "safety" && !S.safetyLoaded && !S.loading) loadSafety();

    /* Roving tabindex: the strip is ONE stop in the page's tab order
       and the arrow keys move inside it, which is what a tablist owes
       a keyboard user. Only the selected tab is reachable with Tab. */
    Array.prototype.forEach.call(
      document.querySelectorAll("#occ-root .occ-tab"),
      function (b) {
        var on = b.getAttribute("data-tab") === tab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.setAttribute("tabindex", on ? "0" : "-1");
      }
    );

    TABS.forEach(function (t) {
      ui.$("occ-panel-" + t).hidden = t !== tab;
    });

    if (!silent) {
      render();
      playPanelEnter(ui.$("occ-panel-" + tab));
    }
  }

  /* Moving the quiet threshold reclassifies assets we already hold - no
     need to go back to MyGeotab for the same records. */
  function setQuietAfter(minutes) {
    var n = Number(minutes);
    ds.setQuietThreshold(n);
    ds.fleetService.redecorate(S.assets);
    /* Re-render happens through the context subscriber, after the
       assets above have been reclassified. */
    if (!C.set({ quietAfter: n })) render();
  }

  function runExport(key) {
    var problem = OCC.exports.run(key, context());
    if (problem) ui.toast(problem);
  }

  /* Cross-panel navigation used by the action links. "See a problem in
     Overview, land on the panel that deals with it." */
  /* target -> [tab, panel to bring into view]. A table rather than a
     chain of else-ifs, so adding a cross-panel link is one line and
     cannot forget to switch the tab. */
  var GOTO = {
    offline:    ["operations",  "occ-offline"],
    cameras:    ["operations",  "occ-cam-notworking"],
    drivers:    ["safety",      "occ-safety-drivers"],
    events:     ["safety",      "occ-safety-events"],
    safety:     ["safety",      null],
    service:    ["maintenance", "occ-mnt-service"],
    faultboard: ["maintenance", "occ-fault-board"],
    register:   ["maintenance", "occ-mnt-table"],
    maintenance: ["maintenance", null]
  };

  function goTo(target) {
    var dest = GOTO[target];
    if (dest) {
      setTab(dest[0]);
      if (dest[1]) scrollToPanel(dest[1]);
      return;
    }
    if (TABS.indexOf(target) !== -1) setTab(target);
  }

  function scrollToPanel(id) {
    var el = ui.$(id);
    if (!el || !el.scrollIntoView) return;
    el.scrollIntoView({
      behavior: ui.prefersReducedMotion() ? "auto" : "smooth",
      block: "center"
    });
  }

  /* ============================================================
     EVENT WIRING
     Bound once at boot, on #occ-root - panel contents are replaced
     constantly, so per-element listeners would not survive.
     ============================================================ */
  var searchTimer = null;

  /* ---- Global shortcut ----------------------------------------------
     Ctrl/Cmd+K focuses search from anywhere in the Add-In.

     Gated on addInActive, and that gate is the whole point: MyGeotab
     keeps an Add-In in the DOM after the operator navigates away, so an
     ungated document listener would keep swallowing Ctrl+K on other
     pages of the host application. A shortcut that fires from a page
     you are not looking at is a bug in someone else's product. */
  var addInActive = true;

  function onShortcut(e) {
    if (!addInActive) return;
    if (e.key !== "k" && e.key !== "K") return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    var input = ui.$("occ-f-search");
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  }

  function wireControls() {
    document.querySelectorAll("#occ-root .occ-tab").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });

      /* Arrow keys move between modes, which is the expected keyboard
         behaviour for a role="tablist" and is what a screen-reader user
         will try. Home/End jump to the ends. */
      b.addEventListener("keydown", function (e) {
        var idx = TABS.indexOf(b.getAttribute("data-tab"));
        var next = null;

        if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
        else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = TABS.length - 1;
        else return;

        e.preventDefault();
        setTab(TABS[next]);
        var btn = ui.$("occ-tab-" + TABS[next]);
        if (btn) btn.focus();
      });
    });

    ui.$("occ-refresh").addEventListener("click", function () {
      if (S.loading) return;
      /* Reseeding only makes sense for the generated preview fleet - it
         is what makes a mock refresh visibly do something. On a live
         session there is nothing to seed, and touching the generator
         from the live path is how a preview artefact reaches real
         numbers. */
      if (ds.useMock()) ds.fleetService.reseed();
      loadAll();
    });

    /* Alerts is a shortcut, not a notification: it jumps to the board
       that can act on the faults with the severity filter already
       applied, so the count and the rows it counts are one gesture
       apart. setFilters first, then setTab - the filter change is what
       guarantees a render even when the severity was already CRITICAL. */
    ui.$("occ-vital-alerts").addEventListener("click", function () {
      C.setFilters({ severity: "CRITICAL" });
      setTab("maintenance");
    });

    document.addEventListener("keydown", onShortcut);

    /* ⌘K on a Mac, Ctrl K everywhere else. Ctrl is the markup default
       because this is read on Windows machines; this only ever swaps it
       the other way. */
    var hint = ui.$("occ-search-hint");
    if (hint && /Mac|iPhone|iPad|iPod/.test(navigator.platform ||
        navigator.userAgent || "")) {
      hint.textContent = "⌘K";
    }

    /* Debounced so typing does not re-render the whole fleet per keystroke. */
    ui.$("occ-f-search").addEventListener("input", function () {
      var v = this.value;
      renderSearchAffordances();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        C.setFilters({ search: v });
      }, 180);
    });

    ui.$("occ-search-clear").addEventListener("click", function () {
      var input = ui.$("occ-f-search");
      input.value = "";
      renderSearchAffordances();
      C.setFilters({ search: "" });
      input.focus();
    });

    /* Escape CLEARS rather than just blurring - a search box someone
       forgot about is the most common reason a dashboard "shows
       nothing". It only swallows the key when there is something to
       clear, so Escape still closes the drawer and the popovers. */
    ui.$("occ-f-search").addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !this.value) return;
      e.preventDefault();
      e.stopPropagation();
      this.value = "";
      renderSearchAffordances();
      C.setFilters({ search: "" });
    });

    ui.$("occ-filter-add").addEventListener("click", function (e) {
      e.stopPropagation();
      OCC.groupPicker.close({ noFocus: true });
      OCC.filters.togglePanel(S, filterMeta());
    });

    ui.$("occ-filter-clear").addEventListener("click", clearAllFilters);

    /* Group picker: the trigger opens and closes it; the panel's own
       handlers (ui/group-picker.js) turn gestures into a context change. */
    ui.$("occ-group-trigger").addEventListener("click", function (e) {
      e.stopPropagation();
      OCC.filters.closePanel();
      OCC.groupPicker.toggle(pickerOpts());
    });
    OCC.groupPicker.init({
      onSelect: function (ids) { C.setFilters({ groupIds: ids }); }
    });

    /* Delegated across the whole root: chips, the advanced panel's
       selects, table rows, sort headers, exports and action links all
       live inside markup that is re-rendered constantly. */
    ui.$("occ-root").addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;

      /* --- Drawer close / scrim ------------------------------------ */
      if (e.target.closest("[data-drawer-close]")) {
        OCC.drawer.close();
        return;
      }

      /* --- Stale-data banner: retry the refresh -------------------- */
      if (e.target.closest("#occ-retry-banner")) {
        if (!S.loading) loadAll();
        return;
      }

      /* --- Dialogs -------------------------------------------------- */
      var exportBtn = e.target.closest("#occ-mnt-export");
      if (exportBtn) {
        e.stopPropagation();
        OCC.dialogs.exportDialog(context(), exportBtn);
        return;
      }
      var woBtn = e.target.closest("[data-workorder-asset]");
      if (woBtn) {
        e.stopPropagation();
        if (woBtn.disabled) return;
        var woAsset = calc.findAsset(S.assets, woBtn.getAttribute("data-workorder-asset"));
        if (woAsset) OCC.dialogs.workOrderDialog(woAsset, context(), woBtn);
        return;
      }

      var drawerAction = e.target.closest("[data-drawer-action]");
      if (drawerAction) {
        handleDrawerAction(drawerAction);
        return;
      }

      /* --- Filter chips ------------------------------------------- */
      var unfilter = e.target.closest("[data-unfilter]");
      if (unfilter) {
        e.stopPropagation();
        clearOneFilter(unfilter.getAttribute("data-unfilter"));
        return;
      }

      /* --- Advanced panel buttons --------------------------------- */
      if (e.target.closest("#occ-filter-reset")) {
        clearAllFilters();
        OCC.filters.renderPanel(S, filterMeta());
        return;
      }
      if (e.target.closest("#occ-filter-done")) {
        OCC.filters.closePanel();
        return;
      }

      /* --- Action links / cross-panel navigation ------------------- */
      var goto = e.target.closest("[data-goto]");
      if (goto) {
        e.stopPropagation();
        goTo(goto.getAttribute("data-goto"));
        return;
      }

      /* --- Activity range segments -------------------------------- */
      var range = e.target.closest("[data-range]");
      if (range) {
        C.set({ activityRange: range.getAttribute("data-range") });
        return;
      }

      /* --- Exports ------------------------------------------------ */
      var exp = e.target.closest(".occ-export");
      if (exp) {
        e.stopPropagation();
        runExport(exp.getAttribute("data-export"));
        return;
      }

      /* --- Inline fault expansion ---------------------------------
         The list opens as a row under the register row, so it is
         content, not an overlay: nothing outside it dismisses it, and
         there is no popover left over the page to sweep up here. */
      var faultBtn = e.target.closest(".occ-faultbtn");
      if (faultBtn) {
        /* Stop propagation so the surrounding row does not also open
           the drawer. */
        e.stopPropagation();
        OCC.maintenance.toggleFaultInline(faultBtn.getAttribute("data-faults"));
        return;
      }
      /* A click inside the expansion is not a click on the register
         row above it, and must not open that asset's drawer. */
      if (e.target.closest(".occ-fault-inline")) return;

      /* Any click outside the advanced panel closes it; same for the
         group picker (its own clicks never reach here - the panel stops
         propagation). */
      if (!e.target.closest("#occ-filter-panel") &&
          !e.target.closest("#occ-filter-add")) {
        OCC.filters.closePanel();
      }
      if (!e.target.closest("#occ-group-panel") &&
          !e.target.closest("#occ-group-trigger")) {
        OCC.groupPicker.close({ noFocus: true });
      }

      /* --- Attention Required: a row IS the incident ----------------
         The drawer opens on exactly the issue the row named, and the
         dashboard stays behind it. */
      var incidentRow = e.target.closest("[data-incident-asset]");
      if (incidentRow) {
        OCC.drawer.open(incidentRow.getAttribute("data-incident-asset"), context(),
                        incidentRow, { incident: OCC.worklist.incidentFrom(incidentRow) });
        return;
      }
      var showAll = e.target.closest("[data-worklist-showall]");
      if (showAll) {
        S.attentionShowAll = showAll.getAttribute("data-worklist-showall") === "1";
        render();
        return;
      }

      /* --- Plan vs actual: a route row opens the route drawer -------- */
      var routeRow = e.target.closest("[data-route-open]");
      if (routeRow) {
        var rid = routeRow.getAttribute("data-route-open");
        var exec = (S.routes && S.routes.executions || []).filter(function (x) { return x.id === rid; })[0];
        if (exec) OCC.drawer.openRoute(exec, context(), routeRow);
        return;
      }

      /* --- Safety events: group by driver or by vehicle ------------- */
      var safetyView = e.target.closest("[data-safety-view]");
      if (safetyView) {
        S.safetyView = safetyView.getAttribute("data-safety-view") === "vehicle"
          ? "vehicle" : "driver";
        render();
        return;
      }

      /* --- Driver scorecard row -> driver drawer --------------------
         Before the generic asset branch: a driver row can also carry a
         vehicle button, and the driver is what was pressed. */
      var driverRow = e.target.closest("[data-driver-open]");
      if (driverRow) {
        OCC.drawer.open({ kind: "driver", id: driverRow.getAttribute("data-driver-open") },
                        context(), driverRow);
        return;
      }

      /* --- Service queue: open in place -----------------------------
         The row and its "Investigate" button are siblings, never
         nested, so this branch and the drawer branch below can never
         both fire for one click. */
      var qToggle = e.target.closest("[data-q-toggle]");
      if (qToggle) {
        e.stopPropagation();
        toggleQueueItem(qToggle);
        return;
      }

      /* --- Asset row -> drawer ------------------------------------ */
      var assetRow = e.target.closest("[data-asset-open]");
      if (assetRow) {
        OCC.drawer.open(assetRow.getAttribute("data-asset-open"), context(), assetRow);
        return;
      }

      /* --- Site drill-down: a site row IS a group ------------------ */
      var siteRow = e.target.closest("[data-site-group]");
      if (siteRow && (siteRow.classList.contains("occ-row-click") ||
                      siteRow.classList.contains("occ-rowbtn"))) {
        var gid = siteRow.getAttribute("data-site-group");
        if (gid) selectGroups([gid]);
        return;
      }

      /* --- Sort ---------------------------------------------------- */
      var th = e.target.closest("[data-sort]");
      if (th) {
        var key = th.getAttribute("data-sort");
        if (S.sortKey === key) {
          C.set({ sortDir: S.sortDir === "asc" ? "desc" : "asc" });
        } else {
          C.set({ sortKey: key, sortDir: "asc" });
        }
      }
    });

    /* Advanced-panel selects, delegated because the panel is rebuilt
       every time it opens. */
    ui.$("occ-root").addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.id) return;

      /* Every branch writes to the context; the subscriber re-renders
         the chips and the active mode. */
      switch (t.id) {
        case "occ-f-status":     C.setFilters({ status: t.value }); break;
        case "occ-f-driver":     C.setFilters({ driver: t.value }); break;
        case "occ-f-severity":   C.setFilters({ severity: t.value }); break;
        case "occ-f-minoffline": C.setFilters({ minOffline: Number(t.value) }); break;
        case "occ-units":        C.set({ units: t.value }); break;
        case "occ-quiet-after":  setQuietAfter(t.value); break;
        default: return;
      }
    });

    /* Keyboard parity for clickable rows and sort headers. Buttons are
       excluded - they already fire click from Enter and Space, and
       forwarding here would act twice. */
    ui.$("occ-root").addEventListener("keydown", function (e) {
      /* Escape unwinds one layer at a time, innermost first, and each
         rung returns focus to whatever opened it. The fault expansion
         sits above the filter panel: it is the thing the operator is
         reading, and the panel is chrome they left open behind it. */
      if (e.key === "Escape") {
        if (OCC.modal.isOpen()) { OCC.modal.close(); return; }
        if (OCC.drawer.isOpen()) { OCC.drawer.close(); return; }
        if (OCC.groupPicker.isOpen()) { OCC.groupPicker.close(); return; }
        if (OCC.maintenance.closeFaultInline({ focus: true })) return;
        if (OCC.filters.isPanelOpen()) { OCC.filters.closePanel(); return; }
        return;
      }

      if (OCC.modal.isOpen()) OCC.modal.trapFocus(e);
      else OCC.drawer.trapFocus(e);

      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("button")) return;
      var target = e.target.closest(".occ-row-click");
      if (!target) return;
      e.preventDefault();
      target.click();
    });

    /* Only the two floating panels close on a click outside the Add-In.
       The fault expansion is in the flow of the register, so it stays
       open the way an expanded row should. */
    document.addEventListener("click", function (e) {
      if (!e.target || !e.target.closest) return;
      if (!e.target.closest("#occ-root")) {
        OCC.filters.closePanel();
        OCC.groupPicker.close({ noFocus: true });
      }
    });
  }

  /* One incident open at a time. Working a worklist means comparing the
     one in front of you against the ranking, not accumulating six open
     panels - and collapsing the others keeps the rest of the queue on
     screen while a detail is open. */
  function toggleQueueItem(row) {
    var id = row.getAttribute("data-q-toggle");
    var panel = ui.$(id);
    if (!panel) return;

    var opening = panel.hidden;
    var list = row.closest(".occ-queue");

    if (list) {
      Array.prototype.forEach.call(
        list.querySelectorAll("[data-q-toggle]"),
        function (other) {
          if (other === row) return;
          var p = ui.$(other.getAttribute("data-q-toggle"));
          if (p) p.hidden = true;
          other.setAttribute("aria-expanded", "false");
          var item = other.closest(".occ-q-item");
          if (item) item.classList.remove("is-open");
        }
      );
    }

    panel.hidden = !opening;
    row.setAttribute("aria-expanded", opening ? "true" : "false");
    var self = row.closest(".occ-q-item");
    if (self) self.classList.toggle("is-open", opening);
  }

  /* Drawer actions are honest about what this Add-In can do: filter the
     dashboard. Raising a work order would need a maintenance system we
     are not connected to. */
  function handleDrawerAction(btn) {
    var action = btn.getAttribute("data-drawer-action");

    if (action === "filter-site") {
      var gid = btn.getAttribute("data-site-group");
      OCC.drawer.close();
      if (gid) selectGroups([gid]);
    } else if (action === "open-asset") {
      /* From the route drawer to the vehicle's own drawer. */
      var assetId = btn.getAttribute("data-asset");
      OCC.drawer.close();
      if (assetId) OCC.drawer.open(assetId, context(), null);
    } else if (action === "create-workorder") {
      if (btn.disabled) return;
      var target = calc.findAsset(S.assets, btn.getAttribute("data-asset-id"));
      if (target) OCC.dialogs.workOrderDialog(target, context(), btn);
    } else if (action === "goto") {
      /* Cross-panel navigation FROM the drawer: close first, or the
         panel it just scrolled to would sit behind the scrim. */
      var dest = btn.getAttribute("data-goto");
      OCC.drawer.close();
      if (dest) goTo(dest);
    } else if (action === "find-asset") {
      var name = btn.getAttribute("data-asset");
      var input = ui.$("occ-f-search");
      if (input) input.value = name;
      OCC.drawer.close();
      C.resetFilters({ search: name });
    }
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    ui = OCC.ui; calc = OCC.calc; ds = OCC.dataService; icons = OCC.icons;
    captureMarkup();
    paintStaticChrome();
    paintPanelChrome();
    wireControls();
    OCC.modal.init();

    /* The context owns the quiet threshold; the service follows it. */
    ds.setQuietThreshold(S.quietAfter);

    setRefreshState("idle");
    renderLiveState();
    startClock();

    /* Nothing is reading the clock while the browser tab is in the
       background, and an Add-In should not keep a timer alive in
       MyGeotab's page for a panel nobody is looking at. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopClock(); else startClock();
    });

    /* silent: nothing is loaded yet, so rendering here would paint
       empty tables for one frame before the skeletons replace them. */
    setTab("overview", true);
    loadAll();
  }

  /* ============================================================
     ADD-IN LIFECYCLE
     MyGeotab keeps an Add-In mounted after the operator navigates away
     from it, so "nobody is looking at this" is a state this module has
     to hold rather than something the browser will tell it. Two things
     depend on holding it correctly, and both would otherwise misbehave
     inside someone else's page: the 1-second clock interval, and the
     document-level Ctrl+K binding.

     Named and exposed rather than written inline in the entry point
     below, so the contract is reachable without loading MyGeotab -
     tests/header.test.js drives the real hooks.
     ============================================================ */
  function onAddInFocus(freshApi, freshState) {
    /* Guarded: the host always passes a fresh session, a caller
       re-focusing an already-connected Add-In does not have to. */
    if (freshApi) OCC.geotabApi.setApi(freshApi, freshState);
    addInActive = true;
    startClock();
    if (!S.assets.length) loadAll();
    /* The operator may have changed MyGeotab's group filter while
       away; follow it (see seedGroupContext). */
    else seedGroupContext();
  }

  function onAddInBlur() {
    OCC.maintenance.closeFaultInline();
    OCC.filters.closePanel();
    OCC.groupPicker.close({ noFocus: true });
    OCC.drawer.close();
    addInActive = false;
    stopClock();
  }

  OCC.addin = { focus: onAddInFocus, blur: onAddInBlur };

  /* ---- MyGeotab Add-In lifecycle ---------------------------------- */
  if (typeof geotab !== "undefined") {
    geotab.addin = geotab.addin || {};
    geotab.addin.operationsMaintenance = function () {
      return {
        initialize: function (freshApi, freshState, initializeCallback) {
          OCC.geotabApi.setApi(freshApi, freshState);
          boot();
          initializeCallback();
        },
        focus: onAddInFocus,
        blur: onAddInBlur
      };
    };
  } else {
    /* Standalone: open preview.html to review the layout against
       sample data, with no MyGeotab session. */
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})(window.OCC);

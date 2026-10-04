/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Side panel shell.
 *
 * Shows a tab for every view - whether or not its data has been gathered yet.
 * A tab with no data shows a button that starts the gathering; a tab that has
 * data shows a refresh icon in the top right. Each view is the original result
 * page (actions.html, pages.html, ...) hosted in a lazily created iframe, so
 * the renderers themselves are untouched.
 *
 * Protocol with background.js:
 *   -> ia_status  {}                    <- {select, pages:{page:{ts,busy}}, tab}
 *   -> ia_load    {page}                start gathering (uses the cache if fresh)
 *   -> ia_refresh {page}                re-gather, bypassing the cache
 *   -> ia_serve   {page}                <- {hit,ts}; pushes <page>_data at the iframe
 *   -> ia_overview {}                   <- {pages:{page:{ts,busy,size}}} (sent by summary.html)
 *   -> ia_cancel  {}                    stop every gather under way (the Stop button)
 *   <- ia_select  {page}                a keyboard shortcut picked a view
 *   <- ia_state   {page, ts, key}       data is cached as of ts, for model key
 *   <- ia_busy    {page, busy, seq}     gathering started / finished
 *   <- ia_progress{page, steps, seq}    live overview of the steps being executed
 *   <- error      {message}
 *   <- ia_page_error {page, message}    a Summary failure, for the panel only (see QUIET in background.js)
 *   <- ia_context {key}                 the model in front changed - re-sync every view
 *
 * Every push carries `to`, the Anaplan tab it is for, and every request carries
 * `forTab`, the tab this panel belongs to (Chrome only - see send() below).
 *
 * The worker never pushes data unsolicited: runtime.sendMessage resolves as soon
 * as *any* extension page listens, so a push sent before the iframe exists would
 * look delivered and be lost. The shell asks for it once the iframe has loaded.
 */
(function () {
  var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

  var VIEWS = [
    { page: 'summary', tab: 'Summary', title: 'Model Summary',
      desc: 'Model name, IDs, size and structure, and which reports are loaded.' },
    { page: 'actions', tab: 'Actions', group: 'Actions', sub: 'IDs', title: 'Actions & File IDs',
      desc: 'Internal IDs for Processes, Imports and Files, to help with API integrations.',
      preview: ['All', 'Processes', 'Imports', 'Exports', 'Actions', 'Files'],
      heading: 'Processes', search: 'Search...', cols: ['Name', 'Identifier'] },
    { page: 'action_usages', tab: 'Usages', group: 'Actions', sub: 'Usages', title: 'Action Usages',
      desc: 'Where your Actions are used across Apps and Pages.',
      heading: 'Action Dependencies', search: 'Search Line Items...', cols: ['App', 'Page', 'Widget', 'Actions'] },
    { page: 'process_steps', tab: 'Steps', group: 'Actions', sub: 'Steps', title: 'Process Steps',
      desc: 'The actions each process runs, in order, with each import\'s source and target - and the actions no process runs.',
      preview: ['Steps', 'Not in a process'],
      heading: 'Process Steps', search: 'Search by process, action, source or target...',
      cols: ['Process', '#', 'Action', 'Source', 'Target'] },
    { page: 'pages', tab: 'Modules', group: 'Pages', sub: 'Modules', title: 'Linked Pages',
      desc: 'Which Apps and Pages use your modules, to track lineage from backend to frontend.',
      heading: 'Module Usage in Pages', search: 'Search Modules...', cols: ['Module', 'Used in Pages'] },
    { page: 'filter_items', tab: 'Filters', group: 'Pages', sub: 'Filters', title: 'Page Filters & Conditional Formatting',
      desc: 'Line Items used as filters or for conditional formatting in your App Pages.',
      preview: ['Filters', 'Conditional Formatting', 'All'],
      heading: 'Filter Line Items', search: 'Search...', cols: ['App', 'Page', 'Widget', 'Line Item', 'Condition'] },
    { page: 'sv_views', tab: 'SV List', group: 'Saved View', sub: 'List', title: 'All Saved Views',
      desc: 'Every Saved View defined in your model, grouped by Module.',
      heading: 'Saved Views', search: 'Search by module or saved view...', cols: ['Module', 'Saved View'] },
    { page: 'sv_screens', tab: 'SV Screens', group: 'Saved View', sub: 'Screens', title: 'Saved Views in Screens',
      desc: 'Which Saved Views each App Page widget reads from.',
      heading: 'Saved Views in Screens', search: 'Search by app, page, widget or saved view...',
      cols: ['App', 'Page', 'Widget', 'Saved View'] },
    { page: 'sv_actions', tab: 'SV Actions', group: 'Saved View', sub: 'Actions', title: 'Saved Views in Actions',
      desc: 'Imports whose source is a Saved View. Exports and processes are not scanned.',
      heading: 'Saved Views in Actions', search: 'Search by import, module or saved view...',
      cols: ['Import', 'Module', 'Saved View'] },
    /* `off`: shown but disabled. Both open every saved view, and Anaplan
       evaluates each view's filters before answering - tens of minutes on a
       large model. The gathers are still in inner.js; the worker refuses them
       (OFF in background.js). They sit last in the group,
       after the reports that can actually be run. */
    { page: 'sv_filter_items', tab: 'SV Filters', group: 'Saved View', sub: 'Filters', title: 'Saved View Filters',
      off: 'Disabled: too slow to run on large models',
      desc: 'Line Items used as filters in your Saved Views.',
      heading: 'Saved Views Filter Items', search: 'Search Items...', cols: ['Module', 'Saved View', 'Item Type', 'Item'] },
    { page: 'sv_line_items', tab: 'SV Items', group: 'Saved View', sub: 'Items', title: 'Line Items in Saved Views',
      off: 'Disabled: too slow to run on large models',
      desc: 'Which Line Items are selected to display inside each Saved View.',
      heading: 'Line Items in Saved Views', search: 'Search by module, saved view or line item...',
      cols: ['Module', 'Saved View', 'Line Item'] },
    /* Structure: read off Anaplan's in-page model cache, so Line Items and
       Lists make no Anaplan calls; Modules adds the app page list. */
    { page: 'modules', tab: 'Modules', group: 'Structure', sub: 'Modules', title: 'Modules',
      desc: 'Every module with its ID, dimensions, line item and saved view counts, and the App pages that use it.',
      preview: ['All', 'Not on a page'],
      heading: 'Modules', search: 'Search by module, ID or dimension...',
      cols: ['Module', 'Dimensions', 'Time Scale', 'Time Range', 'Pages'] },
    { page: 'line_items', tab: 'Line Items', group: 'Structure', sub: 'Line Items', title: 'Line Items',
      desc: 'Every line item in every module with its ID, format, applies-to and formula. Search matches formulas too.',
      heading: 'Line Items', search: 'Search by module, line item, format or formula...',
      cols: ['Module', 'Line Item', 'Format', 'Applies To', 'Formula'] },
    { page: 'lists', tab: 'Lists', group: 'Structure', sub: 'Lists', title: 'Lists & Properties',
      desc: 'Every list with its ID and parent, and every list property with its format and formula.',
      preview: ['Lists', 'Properties'],
      heading: 'Lists', search: 'Search by list, ID or parent...',
      cols: ['List', 'Parent', 'Items', 'Properties'] },
    { page: 'revisions', tab: 'Revisions', title: 'Revision Tags',
      desc: 'The model\'s revision tags - who created each and when - and every model each one was applied to.',
      preview: ['Revision Tags', 'Applied To'],
      heading: 'Revision Tags', search: 'Search by title, description, user or model...',
      cols: ['Title', 'Created by', 'Created on', 'Created in'] },
    /* `live`: runs until Stop (or an hour), then saves what it saw - so it
       is left out of Get all data, and Stop is labelled as saving. */
    { page: 'lock_monitor', tab: 'Lock', title: 'Model Lock Monitor', live: true,
      desc: 'Asks Anaplan, as often as you choose, whether the model is open, busy (and with what), locked or offline - even when the model page won\'t load. The report fills in as it runs; Stop saves it.',
      preview: ['Timeline', 'Checks'],
      heading: 'Timeline', search: 'Search by status, step or task...',
      cols: ['From', 'Duration', 'Status', 'Anaplan says'] },
    { page: 'workspace', tab: 'Workspace', group: 'Workspace', sub: 'Current', title: 'Workspace Models & Storage',
      desc: 'Every model in this workspace with its size and state, and how much of the workspace allowance is used.',
      preview: ['Active', 'Archived', 'Deleted'],
      heading: 'Active Models', search: 'Search by model, state or ID...', cols: ['Model', 'State', 'Size', 'Cells'] },
    /* Gathered apart from Current: a workspace on another Anaplan server can
       take a minute or more to answer, and Current shouldn't wait on it. */
    { page: 'workspace_all', tab: 'All Workspaces', group: 'Workspace', sub: 'All', title: 'All Workspaces',
      desc: 'Storage in use for every workspace you can access, and every active model across them.',
      preview: ['Workspaces', 'Models'],
      heading: 'Workspaces', search: 'Search by workspace or ID...', cols: ['Workspace', 'In use', 'Allowance', 'Full', 'Active models'] }
  ];

  var bar = document.getElementById('tabs'),
      subBar = document.getElementById('subtabs'),
      refreshBtn = document.getElementById('refresh'),
      views = document.getElementById('views'),
      empty = document.getElementById('empty'),
      emptyTitle = document.getElementById('empty-title'),
      emptyDesc = document.getElementById('empty-desc'),
      emptyLoad = document.getElementById('empty-load'),
      emptyNote = document.getElementById('empty-note'),
      emptyPreview = document.getElementById('empty-preview'),
      emptyLk = document.getElementById('empty-lk'),
      lkEvery = document.getElementById('lk-every'),
      lkHours = document.getElementById('lk-hours'),
      lkNotify = document.getElementById('lk-notify'),
      skPlaceholder = document.getElementById('sk-placeholder'),
      skHeading = document.getElementById('sk-heading'),
      skHead = document.getElementById('sk-head'),
      skRows = document.getElementById('sk-rows'),
      progress = document.getElementById('progress'),
      progressHead = document.getElementById('progress-head'),
      stepList = document.getElementById('steps');

  // page -> {ts, busy, frame, loaded, served, note, steps, seq}
  var state = {}, byPage = {}, active = VIEWS[0].page, hasTab = true;

  /* On Chrome the panel belongs to one tab (panelFor in background.js): it is
     only seen while that tab is in front, but its document lives on while
     other tabs are. It used to follow every model change - another model's tab
     coming to the front rebuilt this hidden panel, and coming back rebuilt it
     again. Worse, a run failing in one tab put its error over this panel's
     report. So the panel names its tab on every request (forTab), ignores
     pushes addressed to another tab (to), and hands the tab to its views as
     ?t= for chunks/view_tab.js to do the same there. Nothing is drawn until
     the tab is known. Firefox's sidebar is per window, so there it follows
     the window's tab and hears everything. */
  var myTab = null, myKey = null;
  var ready = api.sidePanel
    ? api.tabs.query({ active: true, currentWindow: true }).then(function (t) {
        if (t && t[0]) myTab = t[0].id;
      }, function () {})
    : Promise.resolve();

  function send(msg) {
    if (myTab != null) msg.forTab = myTab;
    return api.runtime.sendMessage(msg);
  }

  /* Views sharing a `group` get one button in the top bar plus a second row
     of sub-tabs (Actions: IDs | Usages | Steps; Pages: Modules | Filters;
     Saved View: Filters | List | Items | Screens | Actions; Structure:
     Modules | Line Items | Lists). Each is still
     its own page, gather and iframe - only the navigation is merged. `last`
     remembers which member the group button returns to. */
  var groups = {};

  function tabButton(label, title, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.title = title;
    b.innerHTML = '<span class="dot"></span>';
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onClick);
    return b;
  }

  VIEWS.forEach(function (v) {
    byPage[v.page] = v;
    state[v.page] = { ts: 0, busy: false, frame: null, loaded: false, served: 0,
                      note: '', steps: [], seq: 0 };
    if (!v.group) {
      v.btn = tabButton(v.tab, v.title, function () { select(v.page); });
      bar.appendChild(v.btn);
      return;
    }
    var g = groups[v.group];
    if (!g) {
      g = groups[v.group] = { members: [], last: null };
      g.btn = tabButton(v.group, v.group, function () { select(g.last); });
      bar.appendChild(g.btn);
    }
    g.members.push(v);
    if (!g.last && !v.off) g.last = v.page;
    v.sbtn = tabButton(v.sub, v.off ? v.title + ' - ' + v.off : v.title, function () { select(v.page); });
    if (v.off) {
      v.sbtn.disabled = true;
      v.sbtn.dataset.off = '1';
      var tag = document.createElement('span');
      tag.className = 'off';
      tag.textContent = 'Slow';
      v.sbtn.appendChild(tag);
    }
    subBar.appendChild(v.sbtn);
  });

  function paintTab(b, selected, pages) {
    pages = pages.filter(function (p) { return !byPage[p].off; });
    b.setAttribute('aria-selected', selected ? 'true' : 'false');
    b.dataset.has = pages.length && pages.every(function (p) { return state[p].ts; }) ? '1' : '0';
    b.dataset.busy = pages.some(function (p) { return state[p].busy; }) ? '1' : '0';
  }

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    var h = Math.floor(s / 3600);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }

  function select(page) {
    if (!byPage[page] || byPage[page].off) return;
    active = page;
    if (byPage[page].group) groups[byPage[page].group].last = page;
    render();
  }

  function ensureFrame(page) {
    var st = state[page];
    if (st.frame) return;
    var f = document.createElement('iframe');
    f.title = byPage[page].title;
    f.hidden = page !== active;
    f.addEventListener('load', function () {
      st.loaded = true;
      maybeServe(page);
      if (page === 'summary') { tellSummary(); tellQueue(); }
    });
    f.src = '/' + page + '.html' + (myTab != null ? '?t=' + myTab : '');
    views.appendChild(f);
    st.frame = f;
  }

  // Ask the worker to push the cached payload once the iframe can receive it.
  function maybeServe(page) {
    var st = state[page];
    if (!st.frame || !st.loaded || !st.ts || st.served === st.ts) return;
    var ts = st.served = st.ts;
    /* The worker can answer that it no longer has the report: its storage is
       10 MB, and making room for a big one (Line Items) can push older ones
       out. That answer used to be ignored, leaving the view on its loader for
       good. Fall back to Get data and say why. */
    send({ type: 'ia_serve', page: page }).then(function (r) {
      if (!r || r.hit !== false || st.ts !== ts) return;
      if (page === 'summary') { st.ts = 0; st.served = 0; startSummary(); return; }
      if (st.frame) st.frame.remove();
      st.frame = null;
      st.loaded = false;
      st.served = 0;
      st.ts = 0;
      st.note = 'This report is no longer cached - the extension\'s storage was full. Get data to gather it again.';
      render();
    }, function () {
      st.served = 0;
    });
  }

  // The worker hands us the whole step list every time, so this is a plain redraw.
  function paintProgress() {
    var st = state[active];
    // Summary is near-instant and shows its own status line; the overlay would
    // only sit on top of it.
    progress.hidden = !st.busy || active === 'summary';
    if (progress.hidden) return;
    // A live view (Lock Monitor) draws its report as it runs: keep the
    // progress to a strip over it rather than a cover.
    progress.classList.toggle('compact', !!st.ts || !!byPage[active].live);
    progressHead.textContent = byPage[active].live ? 'Monitoring · press Stop to save the report'
      : (st.ts ? 'Refreshing ' : 'Gathering ') + byPage[active].title;

    var steps = st.steps || [];
    if (!steps.length) steps = [{ step: 'Starting…', detail: '', i: null, n: null, done: false }];
    while (stepList.children.length > steps.length) stepList.lastChild.remove();
    while (stepList.children.length < steps.length) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="mark"></span><span class="body">' +
                     '<span class="label"></span><span class="detail"></span>' +
                     '<span class="count"></span><span class="bar"><i></i></span></span>';
      stepList.appendChild(li);
    }
    steps.forEach(function (s, ix) {
      var li = stepList.children[ix],
          last = ix === steps.length - 1,
          loop = s.n != null && s.n > 0;
      li.dataset.state = s.done || !last ? 'done' : 'active';
      li.querySelector('.label').textContent = s.step;
      li.querySelector('.detail').textContent = s.detail || '';
      li.querySelector('.count').textContent = loop ? s.i + ' / ' + s.n : '';
      var bar = li.querySelector('.bar');
      bar.hidden = !loop || !last;
      if (loop) bar.firstChild.style.width = Math.round((s.i / s.n) * 100) + '%';
    });
  }

  /* Before Get data, the view shows a static sketch of itself - its own tab
     bar (VIEWS[].preview, which the compiled views only draw once data
     arrives), the Export and search row, its heading and the table's real
     column headers over a few placeholder rows - so it is clear what Get data
     will produce before committing to a gather. Not interactive. The headings,
     placeholders and columns are copied from the renderers; keep them in step. */
  var SK_ROWS = 7, SK_WIDTHS = [72, 55, 84, 46, 64, 78, 50, 68, 40, 88];

  function paintPreview(v) {
    if (emptyPreview.dataset.for === v.page) return;
    emptyPreview.dataset.for = v.page;

    emptyPreview.textContent = '';
    emptyPreview.hidden = !v.preview;
    (v.preview || []).forEach(function (label, ix) {
      var c = document.createElement('span');
      c.className = 'chip' + (ix === 0 ? ' on' : '');
      c.textContent = label;
      emptyPreview.appendChild(c);
    });

    var cols = v.cols || [],
        grid = 'repeat(' + Math.max(cols.length, 1) + ', minmax(0, 1fr))';
    skPlaceholder.textContent = v.search || 'Search...';
    skHeading.textContent = v.heading || v.title;
    skHead.style.gridTemplateColumns = grid;
    skHead.textContent = '';
    cols.forEach(function (label) {
      var h = document.createElement('span');
      h.textContent = label;
      skHead.appendChild(h);
    });
    skRows.textContent = '';
    for (var r = 0; r < SK_ROWS; r++) {
      var row = document.createElement('div');
      row.className = 'sk-row';
      row.style.gridTemplateColumns = grid;
      cols.forEach(function (_, c) {
        var bar = document.createElement('i');
        bar.style.width = SK_WIDTHS[(r * 3 + c * 7) % SK_WIDTHS.length] + '%';
        row.appendChild(bar);
      });
      skRows.appendChild(row);
    }
  }

  function render() {
    var st = state[active], v = byPage[active];

    VIEWS.forEach(function (x) {
      var s = state[x.page];
      paintTab(x.sbtn || x.btn, x.page === active, [x.page]);
      if (s.frame) s.frame.hidden = x.page !== active;
    });
    Object.keys(groups).forEach(function (name) {
      var g = groups[name];
      paintTab(g.btn, v.group === name, g.members.map(function (x) { return x.page; }));
      g.members.forEach(function (x) { x.sbtn.hidden = v.group !== name; });
    });
    subBar.hidden = !v.group;

    // The iframe exists as soon as there is data, or a gather is under way -
    // the result page renders its own loading and error states.
    // A live view (Lock Monitor) that just failed shows Get data and its note
    // over its old report.
    if ((st.ts && !(v.live && st.note)) || st.busy || active === 'summary') ensureFrame(active);

    // While this view gathers, the refresh button becomes Stop (all gathers).
    var running = VIEWS.filter(function (x) { return state[x.page].busy; }).length;
    refreshBtn.hidden = !st.frame;
    refreshBtn.disabled = false;
    refreshBtn.dataset.busy = st.busy ? '1' : '0';
    refreshBtn.title = st.busy ? (running > 1 ? 'Stop all ' + running + ' running gathers' : v.live ? 'Stop and save' : 'Stop')
      : v.live ? 'Continue monitoring - adds to this report (Clear, in the report, starts over)'
      : st.ts ? 'Refresh · gathered ' + ago(st.ts) : 'Refresh';
    refreshBtn.setAttribute('aria-label', st.busy ? 'Stop' : 'Refresh');

    empty.hidden = !!st.frame;
    if (!st.frame) {
      emptyTitle.textContent = v.title;
      emptyDesc.textContent = v.desc;
      emptyLoad.textContent = st.busy ? 'Gathering…' : v.live ? 'Start monitoring' : 'Get data';
      emptyLoad.disabled = !!st.busy;
      emptyNote.textContent = st.note || (hasTab ? '' : 'Open an Anaplan model tab first.');
      emptyLk.hidden = !v.live;
      paintPreview(v);
    }
    paintProgress();
    maybeServe(active);
  }

  /* Summary auto-runs on open, which is often while the model is still
     loading: the report engine isn't in the frame yet, or the model cache
     isn't built. Rather than show an error, keep retrying quietly until the
     model is ready (or SUMMARY_WAIT runs out), telling the page meanwhile.
     After SUMMARY_QUIET the real reason is shown alongside: a tab whose
     content script was orphaned by an extension reload never finishes
     "loading", and used to sit on the waiting line for the full five minutes. */
  var SUMMARY_WAIT = 5 * 60e3, SUMMARY_RETRY = 2e3, SUMMARY_QUIET = 15e3,
      summary = { deadline: 0, since: 0, timer: 0, status: null };

  function tellSummary() {
    var f = state.summary.frame;
    if (f && state.summary.loaded && f.contentWindow)
      f.contentWindow.postMessage({ type: 'ia_summary_status', status: summary.status }, location.origin);
  }

  function summaryStatus(status) {
    summary.status = status;
    tellSummary();
  }

  function startSummary() {
    clearTimeout(summary.timer);
    summary.timer = 0;
    summary.since = Date.now();
    summary.deadline = summary.since + SUMMARY_WAIT;
    summaryStatus(null);
    start('summary', true);
  }

  function start(page, force) {
    var st = state[page];
    if (st.busy || byPage[page].off) return;
    st.busy = true;
    st.note = '';
    st.steps = [];
    render();
    var msg = { type: force ? 'ia_refresh' : 'ia_load', page: page };
    // Lock Monitor: how often, how long, and whether to notify.
    if (byPage[page].live) {
      msg.every = +lkEvery.value;
      msg.hours = +lkHours.value;
      msg.notify = lkNotify.checked;
    }
    send(msg)
      .then(function (r) { if (r && r.error) fail(page, r.error); },
            function (e) { fail(page, e && e.message); });
  }

  function fail(page, message) {
    var st = state[page];
    if (page === 'summary') {
      st.busy = false;
      st.steps = [];
      if (summary.deadline && Date.now() < summary.deadline) {
        summaryStatus({ text: message && Date.now() - summary.since > SUMMARY_QUIET
          ? 'Still waiting for the model. ' + message
          : 'Waiting for the model to finish loading…' });
        clearTimeout(summary.timer);
        summary.timer = setTimeout(function () {
          summary.timer = 0;
          start('summary', true);
        }, SUMMARY_RETRY);
      } else {
        summaryStatus({ text: message || 'Something went wrong.', error: true });
      }
      render();
      return;
    }
    st.busy = false;
    st.steps = [];
    st.note = message || 'Something went wrong.';
    // With no data the iframe would sit on its own loader forever, hiding the
    // reason - drop it so the view falls back to the message and Get data.
    // A live view drops it either way, so its note shows over the old report.
    if ((!st.ts || byPage[page].live) && st.frame) {
      st.frame.remove();
      st.frame = null;
      st.loaded = false;
      st.served = 0;
    }
    render();
    if (page === queue.current) pump();
  }

  emptyLoad.addEventListener('click', function () { start(active, false); });

  /* Lock Monitor options, remembered in this browser (they're used by "Monitor
     again" too, where the form isn't shown). Notifications are off unless
     ticked, and ticking asks for the permission then - it is optional in the
     manifest, so the extension never holds it unless you want it. */
  var LK_OPTS = 'ia_lk_opts';
  try {
    var o = JSON.parse(localStorage.getItem(LK_OPTS) || '{}');
    if (o.every) lkEvery.value = String(o.every);
    if (o.hours) lkHours.value = String(o.hours);
    lkNotify.checked = !!o.notify;
  } catch (e) {}
  if (!lkEvery.value) lkEvery.value = '1000';
  if (!lkHours.value) lkHours.value = '1';
  function saveLk() {
    try { localStorage.setItem(LK_OPTS, JSON.stringify({ every: lkEvery.value, hours: lkHours.value, notify: lkNotify.checked })); } catch (e) {}
  }
  lkEvery.addEventListener('change', saveLk);
  lkHours.addEventListener('change', saveLk);
  lkNotify.addEventListener('change', function () {
    if (!lkNotify.checked || !api.permissions) { if (!api.permissions) lkNotify.checked = false; saveLk(); return; }
    Promise.resolve(api.permissions.request({ permissions: ['notifications'] }))
      .then(function (ok) { lkNotify.checked = !!ok; saveLk(); }, function () { lkNotify.checked = false; saveLk(); });
  });
  refreshBtn.addEventListener('click', function () {
    if (state[active].busy) stop();
    else if (active === 'summary') startSummary();
    else start(active, true);
  });

  // Stop every gather. The worker clears busy for all of them and drops their
  // late results; a view that had no data yet falls back to its Get data
  // screen (fail() removes the iframe still showing its loader).
  /* "Get all data" (Summary): every report not loaded yet, gathered one after
     another rather than all at once - inner.js reports progress for one run
     at a time, and a dozen gathers at once would all load the model together.
     The queue moves on whenever the running report stops being busy: done,
     served from cache, failed or stopped. Summary asks with ia_getall /
     ia_getall_stop and is told how far along it is with ia_getall_status. */
  var queue = { pages: [], current: null, total: 0 };

  function tellQueue() {
    var f = state.summary.frame;
    if (!f || !state.summary.loaded || !f.contentWindow) return;
    f.contentWindow.postMessage({ type: 'ia_getall_status', running: !!queue.current, total: queue.total,
      done: queue.total - queue.pages.length - (queue.current ? 1 : 0),
      current: queue.current ? byPage[queue.current].title : '' }, location.origin);
  }

  function getAll() {
    if (queue.current) return;
    queue.pages = VIEWS.filter(function (v) {
      return v.page !== 'summary' && !v.off && !v.live && !state[v.page].ts && !state[v.page].busy;
    }).map(function (v) { return v.page; });
    queue.total = queue.pages.length;
    pump();
  }

  function pump() {
    if (queue.current && state[queue.current].busy) return;
    queue.current = null;
    while (queue.pages.length) {
      var p = queue.pages.shift();
      if (state[p].ts || state[p].busy) continue;
      queue.current = p;
      start(p, false);
      break;
    }
    if (!queue.current) queue.total = 0;
    tellQueue();
  }

  function dropQueue() {
    queue.pages = [];
    queue.current = null;
    queue.total = 0;
    tellQueue();
  }

  window.addEventListener('message', function (e) {
    var f = state.summary.frame;
    if (!f || e.source !== f.contentWindow || e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'ia_getall') getAll();
    if (e.data.type === 'ia_getall_stop' && queue.current) stop();
  });

  function stop() {
    dropQueue();
    clearTimeout(summary.timer);
    summary.timer = 0;
    summary.deadline = 0;
    var was = VIEWS.filter(function (x) { return state[x.page].busy; });
    send({ type: 'ia_cancel' }).catch(function () {});
    // Stop is how a live view (Lock Monitor) finishes, not a failure: keep its
    // report on screen until the worker's saved copy arrives (ia_state).
    was.forEach(function (x) {
      if (x.live) { state[x.page].busy = false; state[x.page].steps = []; render(); }
      else fail(x.page, 'Stopped.');
    });
  }

  // Pushes for one page are latest-wins, so ignore anything that arrives late.
  function fresh(page, seq) {
    if (seq == null) return true;
    if (seq <= state[page].seq) return false;
    state[page].seq = seq;
    return true;
  }

  api.runtime.onMessage.addListener(function (msg) {
    if (!msg || !msg.type) return;
    if (myTab != null && msg.to != null && msg.to !== myTab) return;
    // A gather announces itself with ia_select (it is how a keyboard shortcut
    // opens its view); during Get all data the panel stays where it is.
    if (msg.type === 'ia_select') { if (msg.page !== queue.current) select(msg.page); return; }
    if (msg.type === 'ia_page_error' && state[msg.page]) { fail(msg.page, msg.message); return; }
    if (msg.type === 'ia_state' && state[msg.page]) {
      if (msg.key != null && myKey != null && msg.key !== myKey) return;
      if (msg.page === 'summary') { clearTimeout(summary.timer); summary.timer = 0; summary.deadline = 0; summaryStatus(null); }
      state[msg.page].ts = msg.ts || 0;
      state[msg.page].note = '';
      if (state[msg.page].ts) maybeServe(msg.page);
      // No report any more (Lock Monitor's Clear): back to the start screen.
      else if (state[msg.page].frame && !state[msg.page].busy) {
        state[msg.page].frame.remove();
        state[msg.page].frame = null;
        state[msg.page].loaded = false;
        state[msg.page].served = 0;
      }
      render();
      return;
    }
    if (msg.type === 'ia_busy' && state[msg.page]) {
      if (!fresh(msg.page, msg.seq)) return;
      state[msg.page].busy = !!msg.busy;
      if (msg.busy) state[msg.page].steps = [];
      render();
      if (!msg.busy && msg.page === queue.current) pump();
      return;
    }
    if (msg.type === 'ia_progress' && state[msg.page]) {
      if (!fresh(msg.page, msg.seq)) return;
      state[msg.page].steps = msg.steps || [];
      render();
      return;
    }
    if (msg.type === 'error') {
      VIEWS.forEach(function (v) { if (v.page !== 'summary' && state[v.page].busy) fail(v.page, msg.message); });
    }
    if (msg.type === 'ia_context') {
      if (msg.key === myKey) { catchUp(); return; }
      myKey = msg.key;
      switchModel();
    }
  });

  /* The model in front changed (another tab, window or model). Every view was
     showing the previous model, so drop the iframes and re-sync: the worker
     answers with this model's cache - each model keeps its own entries, so
     switching back is instant - and anything not gathered for it yet falls
     back to Get data. Summary is served from cache when it has one rather than
     re-gathered, so a model that is still loading announces itself once more
     when ready without the view flickering through a second gather. */
  function switchModel() {
    dropQueue();
    clearTimeout(summary.timer);
    summary.timer = 0;
    summary.deadline = 0;
    summaryStatus(null);
    VIEWS.forEach(function (v) {
      var st = state[v.page];
      if (st.frame) st.frame.remove();
      st.frame = null;
      st.loaded = false;
      st.served = 0;
      st.ts = 0;
      st.note = '';
      st.steps = [];
    });
    sync(false);
  }

  /* Our tab is back in front with the model we already show. Nothing to drop,
     but a run that finished while another model was in front was not announced
     (ia_state goes to the model in front only), so pick up what changed and
     serve just those views - the rest stay exactly as they are. */
  function catchUp() {
    send({ type: 'ia_status' }).then(function (r) {
      if (!r || !r.pages) return;
      VIEWS.forEach(function (v) {
        var s = r.pages[v.page], st = state[v.page];
        if (!s) return;
        st.busy = !!s.busy;
        st.steps = s.steps || [];
        if (s.ts && s.ts !== st.ts) { st.ts = s.ts; st.note = ''; maybeServe(v.page); }
      });
      render();
    }, function () {});
  }

  function sync(first) {
    send({ type: 'ia_status' }).then(function (r) {
      if (r && r.pages) {
        VIEWS.forEach(function (v) {
          var s = r.pages[v.page];
          if (!s) return;
          state[v.page].ts = s.ts || 0;
          state[v.page].busy = !!s.busy;
          state[v.page].steps = s.steps || [];
        });
      }
      if (r && typeof r.tab === 'boolean') hasTab = r.tab;
      if (r && typeof r.key === 'string') myKey = r.key;
      if (first && r && r.select && byPage[r.select] && !byPage[r.select].off) active = r.select;
      render();
      // Summary is instant (no Anaplan calls), so gather it on open rather than
      // making the first thing anyone sees a "Get data" button.
      if (first || (hasTab && !state.summary.ts)) {
        state.summary.busy = false;
        startSummary();
      } else if (!hasTab && !state.summary.ts) {
        summaryStatus({ text: 'Open an Anaplan model tab.', error: true });
      }
    }, function () { render(); });
  }
  ready.then(function () {
    sync(true);
    render();
  });
  setInterval(function () { if (!refreshBtn.hidden) render(); }, 30000);
})();

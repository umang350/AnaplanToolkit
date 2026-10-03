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
 *   <- ia_state   {page, ts}            data is cached as of ts
 *   <- ia_busy    {page, busy, seq}     gathering started / finished
 *   <- ia_progress{page, steps, seq}    live overview of the steps being executed
 *   <- error      {message}
 *   <- ia_page_error {page, message}    a Summary failure, for the panel only (see QUIET in background.js)
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
    { page: 'actions', tab: 'Actions', title: 'Actions & File IDs',
      desc: 'Internal IDs for Processes, Imports and Files, to help with API integrations.' },
    { page: 'action_usages', tab: 'Usages', title: 'Action Usages',
      desc: 'Where your Actions are used across Apps and Pages.' },
    { page: 'pages', tab: 'Modules', title: 'Linked Pages',
      desc: 'Which Apps and Pages use your modules, to track lineage from backend to frontend.' },
    { page: 'filter_items', tab: 'Filters', title: 'Page Filters & Conditional Formatting',
      desc: 'Line Items used as filters or for conditional formatting in your App Pages.' },
    { page: 'sv_filter_items', tab: 'SV Filters', title: 'Saved View Filters',
      desc: 'Line Items used as filters in your Saved Views.' },
    { page: 'sv_views', tab: 'SV List', title: 'All Saved Views',
      desc: 'Every Saved View defined in your model, grouped by Module.' },
    { page: 'sv_line_items', tab: 'SV Items', title: 'Line Items in Saved Views',
      desc: 'Which Line Items are selected to display inside each Saved View.' },
    { page: 'sv_screens', tab: 'SV Screens', title: 'Saved Views in Screens',
      desc: 'Which Saved Views each App Page widget reads from.' },
    { page: 'sv_actions', tab: 'SV Actions', title: 'Saved Views in Actions',
      desc: 'Imports whose source is a Saved View. Exports and processes are not scanned.' }
  ];

  var bar = document.getElementById('tabs'),
      refreshBtn = document.getElementById('refresh'),
      views = document.getElementById('views'),
      empty = document.getElementById('empty'),
      emptyTitle = document.getElementById('empty-title'),
      emptyDesc = document.getElementById('empty-desc'),
      emptyLoad = document.getElementById('empty-load'),
      emptyNote = document.getElementById('empty-note'),
      progress = document.getElementById('progress'),
      progressHead = document.getElementById('progress-head'),
      stepList = document.getElementById('steps');

  // page -> {ts, busy, frame, loaded, served, note, steps, seq}
  var state = {}, byPage = {}, active = VIEWS[0].page, hasTab = true;

  VIEWS.forEach(function (v) {
    byPage[v.page] = v;
    state[v.page] = { ts: 0, busy: false, frame: null, loaded: false, served: 0,
                      note: '', steps: [], seq: 0 };
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.page = v.page;
    b.title = v.title;
    b.innerHTML = '<span class="dot"></span>';
    b.appendChild(document.createTextNode(v.tab));
    b.addEventListener('click', function () { select(v.page); });
    bar.appendChild(b);
    v.btn = b;
  });

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    var h = Math.floor(s / 3600);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }

  function select(page) {
    if (!byPage[page]) return;
    active = page;
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
      if (page === 'summary') tellSummary();
    });
    f.src = '/' + page + '.html';
    views.appendChild(f);
    st.frame = f;
  }

  // Ask the worker to push the cached payload once the iframe can receive it.
  function maybeServe(page) {
    var st = state[page];
    if (!st.frame || !st.loaded || !st.ts || st.served === st.ts) return;
    st.served = st.ts;
    api.runtime.sendMessage({ type: 'ia_serve', page: page }).catch(function () {
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
    progress.classList.toggle('compact', !!st.ts);
    progressHead.textContent = (st.ts ? 'Refreshing ' : 'Gathering ') + byPage[active].title;

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

  function render() {
    var st = state[active], v = byPage[active];

    VIEWS.forEach(function (x) {
      var s = state[x.page];
      x.btn.setAttribute('aria-selected', x.page === active ? 'true' : 'false');
      x.btn.dataset.has = s.ts ? '1' : '0';
      x.btn.dataset.busy = s.busy ? '1' : '0';
      if (s.frame) s.frame.hidden = x.page !== active;
    });

    // The iframe exists as soon as there is data, or a gather is under way -
    // the result page renders its own loading and error states.
    if (st.ts || st.busy || active === 'summary') ensureFrame(active);

    // While this view gathers, the refresh button becomes Stop (all gathers).
    var running = VIEWS.filter(function (x) { return state[x.page].busy; }).length;
    refreshBtn.hidden = !st.frame;
    refreshBtn.disabled = false;
    refreshBtn.dataset.busy = st.busy ? '1' : '0';
    refreshBtn.title = st.busy ? (running > 1 ? 'Stop all ' + running + ' running gathers' : 'Stop')
      : st.ts ? 'Refresh · gathered ' + ago(st.ts) : 'Refresh';
    refreshBtn.setAttribute('aria-label', st.busy ? 'Stop' : 'Refresh');

    empty.hidden = !!st.frame;
    if (!st.frame) {
      emptyTitle.textContent = v.title;
      emptyDesc.textContent = v.desc;
      emptyLoad.textContent = st.busy ? 'Gathering…' : 'Get data';
      emptyLoad.disabled = !!st.busy;
      emptyNote.textContent = st.note || (hasTab ? '' : 'Open an Anaplan model tab first.');
    }
    paintProgress();
    maybeServe(active);
  }

  /* Summary auto-runs on open, which is often while the model is still
     loading: the report engine isn't in the frame yet, or the model cache
     isn't built. Rather than show an error, keep retrying quietly until the
     model is ready (or SUMMARY_WAIT runs out), telling the page meanwhile. */
  var SUMMARY_WAIT = 5 * 60e3, SUMMARY_RETRY = 3e3,
      summary = { deadline: 0, timer: 0, status: null };

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
    summary.deadline = Date.now() + SUMMARY_WAIT;
    summaryStatus(null);
    start('summary', true);
  }

  function start(page, force) {
    var st = state[page];
    if (st.busy) return;
    st.busy = true;
    st.note = '';
    st.steps = [];
    render();
    api.runtime.sendMessage({ type: force ? 'ia_refresh' : 'ia_load', page: page })
      .then(function (r) { if (r && r.error) fail(page, r.error); },
            function (e) { fail(page, e && e.message); });
  }

  function fail(page, message) {
    var st = state[page];
    if (page === 'summary') {
      st.busy = false;
      st.steps = [];
      if (summary.deadline && Date.now() < summary.deadline) {
        summaryStatus({ text: 'Waiting for the model to finish loading…' });
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
    if (!st.ts && st.frame) {
      st.frame.remove();
      st.frame = null;
      st.loaded = false;
      st.served = 0;
    }
    render();
  }

  emptyLoad.addEventListener('click', function () { start(active, false); });
  refreshBtn.addEventListener('click', function () {
    if (state[active].busy) stop();
    else if (active === 'summary') startSummary();
    else start(active, true);
  });

  // Stop every gather. The worker clears busy for all of them and drops their
  // late results; a view that had no data yet falls back to its Get data
  // screen (fail() removes the iframe still showing its loader).
  function stop() {
    clearTimeout(summary.timer);
    summary.timer = 0;
    summary.deadline = 0;
    var was = VIEWS.filter(function (x) { return state[x.page].busy; });
    api.runtime.sendMessage({ type: 'ia_cancel' }).catch(function () {});
    was.forEach(function (x) { fail(x.page, 'Stopped.'); });
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
    if (msg.type === 'ia_select') { select(msg.page); return; }
    if (msg.type === 'ia_page_error' && state[msg.page]) { fail(msg.page, msg.message); return; }
    if (msg.type === 'ia_state' && state[msg.page]) {
      if (msg.page === 'summary') { clearTimeout(summary.timer); summary.timer = 0; summary.deadline = 0; summaryStatus(null); }
      state[msg.page].ts = msg.ts || 0;
      state[msg.page].note = '';
      if (state[msg.page].ts) maybeServe(msg.page);
      render();
      return;
    }
    if (msg.type === 'ia_busy' && state[msg.page]) {
      if (!fresh(msg.page, msg.seq)) return;
      state[msg.page].busy = !!msg.busy;
      if (msg.busy) state[msg.page].steps = [];
      render();
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
  });

  api.runtime.sendMessage({ type: 'ia_status' }).then(function (r) {
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
    if (r && r.select && byPage[r.select]) active = r.select;
    render();
    // Summary is instant (no Anaplan calls), so gather it on open rather than
    // making the first thing anyone sees a "Get data" button.
    startSummary();
  }, function () { render(); });

  render();
  setInterval(function () { if (!refreshBtn.hidden) render(); }, 30000);
})();

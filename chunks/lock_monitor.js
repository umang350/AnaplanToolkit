/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell } from './sv_shared.js';
import { stackCell } from './structure_shared.js';

/* Lock Monitor - what the model's lock / busy state was, once a second, for
   as long as the monitor ran (IA_glock in content-scripts/inner.js). Each
   check is one workspace summary call, read for this model's row:

     samples[]  {t, ms, http, state, open, unload, extra, hot, banner, err, status}
                t = when the check was sent (epoch ms), ms = how long it took
     started, ended, every, slow, why ('stopped' | 'limit' | 'errors'), keys

   status is decided in the content script (IA_lkStatus): Locked / Offline
   from the model's state or HTTP 423 / 424, Busy from Anaplan's busy banner
   or a busy flag in the reply, Slow reply when the check took `slow` ms or
   more, No reply when it failed. Timeline merges consecutive checks with the
   same status and model state into one period. */

var COLOR = { Available: 'ok', Busy: 'warn', 'Slow reply': 'warn', Locked: 'bad', Offline: 'bad', 'No reply': 'off' };

function samples(d) { return (d && Array.isArray(d.samples)) ? d.samples : []; }

function p2(n) { return String(n).padStart(2, '0'); }
function clock(ts) {
  var d = new Date(ts);
  return isNaN(d) ? '' : p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}
function stamp(ts) {
  var d = new Date(ts);
  return isNaN(d) ? '' : d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + clock(ts);
}
function dur(ms) {
  var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? h + 'h ' + p2(m) + 'm' : m ? m + 'm ' + p2(s % 60) + 's' : s + 's';
}
function reply(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms'; }
function word(s) {
  s = String(s || '').toLowerCase().replace(/_/g, ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// The model state line under a status: state, loaded or not, and whatever else was seen.
function stateBits(r) {
  return [word(r.state) || (r.err ? '' : '–'), r.open === false ? 'Not loaded' : '', r.unload ? 'Marked for unload' : ''];
}
function detail(r) {
  return [r.err, r.banner && 'Page: "' + r.banner + '"', r.extra].filter(Boolean).join(' · ');
}

function tag(status) {
  var s = el('span', 'ia-lk', status || '–');
  s.dataset.lk = COLOR[status] || 'off';
  return s;
}
function statusCell(status, span) {
  var wrap = el('div', span + ' min-w-0');
  wrap.appendChild(tag(status));
  return wrap;
}

// Consecutive checks with the same status and model state, as one period.
var memo = new WeakMap();
function periods(d) {
  if (!d) return [];
  if (memo.has(d)) return memo.get(d);
  var list = samples(d), out = [], cur = null;
  list.forEach(function (s) {
    if (!cur || cur.status !== s.status || cur.state !== s.state) {
      if (cur) cur.to = s.t;
      cur = { status: s.status, state: s.state, open: s.open, unload: s.unload, from: s.t, to: s.t + s.ms,
              checks: 0, slowest: 0, err: '', banner: '', extra: '' };
      out.push(cur);
    }
    cur.checks++;
    cur.to = Math.max(cur.to, s.t + s.ms);
    cur.slowest = Math.max(cur.slowest, s.ms);
    cur.open = s.open; cur.unload = s.unload;
    cur.err = cur.err || s.err;
    cur.banner = cur.banner || s.banner;
    cur.extra = s.extra || cur.extra;
  });
  out.forEach(function (p) { p.ms = p.to - p.from; });
  memo.set(d, out);
  return out;
}

function median(xs) {
  if (!xs.length) return 0;
  var s = xs.slice().sort(function (a, b) { return a - b; });
  return s[Math.floor(s.length / 2)];
}

var WHY = {
  limit: 'Stopped on its own after an hour.',
  errors: 'Stopped on its own: Anaplan stopped answering the checks.'
};

function top(d) {
  var list = samples(d);
  if (!list.length) return null;
  var ps = periods(d), last = list[list.length - 1],
      start = d.started || list[0].t, end = d.ended || last.t + last.ms, span = Math.max(1, end - start),
      box = el('div', 'ia-ws'), wrap = el('div', 'ia-ws-list');

  var head = el('div', 'ia-ws-head');
  head.appendChild(el('span', 'ia-ws-name', d.modelName || d.modelId || 'Model'));
  var now = el('span', 'ia-ws-pct', 'Last: ');
  now.appendChild(tag(last.status));
  head.appendChild(now);
  box.appendChild(head);

  // Status over time: one segment per period, as wide as it lasted.
  var strip = el('div', 'ia-lk-strip');
  strip.setAttribute('role', 'img');
  ps.forEach(function (p) {
    var seg = el('i');
    seg.dataset.lk = COLOR[p.status] || 'off';
    seg.style.flexGrow = String(Math.max(p.ms, 1));
    seg.title = p.status + ' · ' + clock(p.from) + ' – ' + clock(p.to) + ' (' + dur(p.ms) + ')';
    strip.appendChild(seg);
  });
  strip.setAttribute('aria-label', 'Status over time: ' + ps.map(function (p) { return p.status + ' ' + dur(p.ms); }).join(', '));
  box.appendChild(strip);

  var share = {};
  ps.forEach(function (p) { share[p.status] = (share[p.status] || 0) + p.ms; });
  box.appendChild(el('p', 'ia-ws-line', Object.keys(share)
    .sort(function (a, b) { return share[b] - share[a]; })
    .map(function (k) { return k + ' ' + Math.round(share[k] / span * 100) + '% (' + dur(share[k]) + ')'; })
    .join(' · ')));
  box.appendChild(el('p', 'ia-ws-line',
    stamp(start) + ' – ' + clock(end) + ' · ' + dur(span) + ' · ' + list.length.toLocaleString() +
    (list.length === 1 ? ' check' : ' checks') + ' · ' + ps.length + (ps.length === 1 ? ' period' : ' periods')));
  var ok = list.filter(function (s) { return !s.err; }).map(function (s) { return s.ms; });
  if (ok.length)
    box.appendChild(el('p', 'ia-ws-line', 'Reply time: median ' + reply(median(ok)) + ' · slowest ' +
                       reply(Math.max.apply(null, ok))));
  var worst = ps.filter(function (p) { return p.status !== 'Available'; })
    .sort(function (a, b) { return b.ms - a.ms; })[0];
  if (worst)
    box.appendChild(el('p', 'ia-ws-line', 'Longest unavailable: ' + worst.status + ' for ' + dur(worst.ms) +
                       ' from ' + clock(worst.from)));
  if (WHY[d.why]) box.appendChild(el('p', 'ia-ws-line', WHY[d.why]));
  wrap.appendChild(box);

  if (d.keys && d.keys.length) {
    var f = el('details', 'ia-fields-seen');
    f.appendChild(el('summary', null, 'Show the fields Anaplan provided for this model'));
    f.appendChild(el('p', null, d.keys.join(', ')));
    wrap.appendChild(f);
  }
  return wrap;
}

var NOTE = 'One check a second, never two at once: a slow reply delays the next check rather than ' +
  'queueing behind it. Locked / Offline: the model\'s state (Model Management\'s Lock or Take offline). ' +
  'Busy: Anaplan\'s own busy banner or flag. Slow reply: a check took 3 s or more - usually a process, ' +
  'import, export or large calculation holding the model.';

renderPage({
  page: 'lock_monitor',
  placeholder: 'Search by status or model state...',
  tabs: [
    {
      label: 'Timeline',
      heading: 'Timeline',
      top: top,
      note: NOTE,
      rows: periods,
      cols: 'grid-cols-12',
      headers: [{ label: 'From', cls: 'col-span-3', sort: function (r) { return r.from; } },
                { label: 'Duration', cls: 'col-span-2', sort: function (r) { return r.ms; } },
                { label: 'Status', cls: 'col-span-3', sort: function (r) { return r.status; } },
                { label: 'Model state', cls: 'ia-span-4', sort: function (r) { return r.state; } }],
      key: function (r) { return r.status + ' ' + word(r.state) + ' ' + detail(r); },
      cells: function (r) {
        return [
          stackCell([clock(r.from), 'to ' + clock(r.to)], 'col-span-3 ia-num'),
          stackCell([dur(r.ms), r.checks + (r.checks === 1 ? ' check' : ' checks')], 'col-span-2'),
          statusCell(r.status, 'col-span-3'),
          // Reply time only where it matters - a second or more.
          stackCell([stateBits(r).filter(Boolean).join(' · '),
                     r.slowest >= 1000 && 'Slowest reply ' + reply(r.slowest), detail(r)], 'ia-span-4')
        ];
      },
      csvRow: function (r) {
        return { From: stamp(r.from), To: stamp(r.to), DurationSeconds: Math.round(r.ms / 1000), Status: r.status,
                 ModelState: r.state, Loaded: r.open == null ? '' : r.open ? 'Yes' : 'No',
                 MarkedForUnload: r.unload ? 'Yes' : 'No', Checks: r.checks, SlowestReplyMs: r.slowest,
                 Error: r.err, PageBanner: r.banner, OtherFields: r.extra };
      },
      filename: 'model-lock-timeline.csv'
    },
    {
      label: 'Checks',
      heading: 'Checks',
      top: top,
      note: 'Every check, oldest first.',
      rows: samples,
      max: 500,
      cols: 'grid-cols-12',
      headers: [{ label: 'Time', cls: 'col-span-2', sort: function (r) { return r.t; } },
                { label: 'Status', cls: 'col-span-3', sort: function (r) { return r.status; } },
                { label: 'Model state', cls: 'ia-span-5', sort: function (r) { return r.state; } },
                { label: 'Reply', cls: 'col-span-2', sort: function (r) { return r.err ? null : r.ms; } }],
      key: function (r) { return clock(r.t) + ' ' + r.status + ' ' + word(r.state) + ' ' + detail(r); },
      cells: function (r) {
        return [
          textCell(clock(r.t), 'col-span-2 text-sm text-foreground ia-num'),
          statusCell(r.status, 'col-span-3'),
          stackCell([stateBits(r).filter(Boolean).join(' · '), detail(r)], 'ia-span-5'),
          textCell(r.err ? '–' : reply(r.ms), 'col-span-2 text-sm text-muted-foreground ia-num')
        ];
      },
      csvRow: function (r) {
        return { Time: stamp(r.t), Status: r.status, ModelState: r.state,
                 Loaded: r.open == null ? '' : r.open ? 'Yes' : 'No', MarkedForUnload: r.unload ? 'Yes' : 'No',
                 ReplyMs: r.ms, HTTP: r.http || '', Error: r.err, PageBanner: r.banner, OtherFields: r.extra };
      },
      filename: 'model-lock-checks.csv'
    }
  ]
});

/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell } from './sv_shared.js';
import { stackCell } from './structure_shared.js';

/* Lock Monitor - what Anaplan said the model was doing, once a second, for as
   long as the monitor ran (lkLoop in background.js). Each check is one call
   to the Integration API's model status (POST /2/0/workspaces/{w}/models/{m}/
   status), made from the worker so it works even when the model page won't
   load:

     samples[]  {t, ms, http, step, progress, tooltip, taskId, type, err, status}
                t = when the check was sent (epoch ms), ms = how long it took,
                step / progress / tooltip / taskId / type = requestStatus's
                currentStep / progress / tooltip / taskId / exportTaskType
     modelName, started, ended, every, slow, why, keys, login

   status is decided in the worker (lkProbe): Available when currentStep is
   "Open" with no task, Busy when it names anything else, Locked / Offline on
   HTTP 423 / 424, Not loaded for a closed model, Slow reply for an "Open"
   that took `slow` ms or more. Timeline merges consecutive checks with the
   same status and step into one period. */

var COLOR = { Available: 'ok', Busy: 'warn', Updating: 'soft', 'Slow reply': 'warn', Locked: 'bad', Offline: 'bad',
              'Not loaded': 'off', 'No reply': 'off', 'Login refused': 'bad', Unknown: 'off' };

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

function pct(p) {
  if (typeof p !== 'number' || p < 0) return '';
  return Math.round(p <= 1 ? p * 100 : p) + '%';
}
// What Anaplan said: its current step, how far along, and the task it names.
// Anaplan writes its times in UTC ("Submitted at 08:17 (UTC)"); show them in
// the viewer's time zone, on the day of the check - the day before when that
// would put them after it. The CSV keeps Anaplan's own text alongside.
function localTip(tip, at) {
  if (!tip) return '';
  return String(tip).replace(/\b(\d{1,2}):(\d{2})\s*\(UTC\)/g, function (m, h, mi) {
    var d = new Date(at);
    if (isNaN(d)) return m;
    var u = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +h, +mi);
    if (u > at + 36e5) u -= 864e5;
    var x = new Date(u);
    return p2(x.getHours()) + ':' + p2(x.getMinutes());
  });
}
function says(r) { return [r.step || (r.err ? '' : '–'), pct(r.progress)].filter(Boolean).join(' · '); }
function detail(r) {
  return [r.err, localTip(r.tooltip, r.t || r.from), r.type && 'Task type ' + r.type, r.taskId && 'Task ' + r.taskId]
    .filter(Boolean).join(' · ');
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

// Consecutive checks with the same status and step, as one period.
var memo = new WeakMap();
function periods(d) {
  if (!d) return [];
  if (memo.has(d)) return memo.get(d);
  var list = samples(d), out = [], cur = null;
  list.forEach(function (s) {
    if (!cur || cur.status !== s.status || cur.step !== s.step) {
      if (cur) cur.to = s.t;
      cur = { status: s.status, step: s.step, progress: null, from: s.t, to: s.t + s.ms,
              checks: 0, slowest: 0, err: '', tooltip: '', taskId: '', type: '' };
      out.push(cur);
    }
    cur.checks++;
    cur.to = Math.max(cur.to, s.t + s.ms);
    cur.slowest = Math.max(cur.slowest, s.ms);
    cur.progress = s.progress;   // the last one seen
    cur.err = cur.err || s.err;
    cur.tooltip = s.tooltip || cur.tooltip;
    cur.taskId = cur.taskId || s.taskId;
    cur.type = cur.type || s.type;
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
  running: 'Interrupted: the browser stopped the extension\'s background task mid-run. This is what it saw until then.',
  limit: 'Stopped on its own after an hour.',
  errors: 'Stopped on its own: Anaplan stopped answering the checks.',
  auth: 'Stopped on its own: Anaplan\'s API stopped accepting the login (a token lasts 35 minutes).'
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
    (list.length === 1 ? ' check' : ' checks') + ' every ' + dur(d.every || 1000) + ' · ' + ps.length +
    (ps.length === 1 ? ' period' : ' periods')));
  var ok = list.filter(function (s) { return !s.err; }).map(function (s) { return s.ms; });
  if (ok.length)
    box.appendChild(el('p', 'ia-ws-line', 'Reply time: median ' + reply(median(ok)) + ' · slowest ' +
                       reply(Math.max.apply(null, ok))));
  var worst = ps.filter(function (p) { return p.status !== 'Available'; })
    .sort(function (a, b) { return b.ms - a.ms; })[0];
  if (worst)
    box.appendChild(el('p', 'ia-ws-line', 'Longest unavailable: ' + worst.status + ' for ' + dur(worst.ms) +
                       ' from ' + clock(worst.from)));
  if (d.live) box.appendChild(el('p', 'ia-ws-line', 'Monitoring now - this updates as it goes. Stop saves the report.'));
  else if (WHY[d.why]) box.appendChild(el('p', 'ia-ws-line', WHY[d.why]));
  wrap.appendChild(box);

  if (d.keys && d.keys.length) {
    var f = el('details', 'ia-fields-seen');
    f.appendChild(el('summary', null, 'Show the fields Anaplan\'s status reply held'));
    f.appendChild(el('p', null, d.keys.join(', ')));
    wrap.appendChild(f);
  }
  return wrap;
}

// What the checks were depends on how the run got its answers (lkProbe).
function note(d) {
  var how = d && d.login === 'session'
    ? 'Each check asks the model\'s server the way Anaplan\'s own screen does to show "Model is busy", over your session.'
    : 'Each check reads the model status from Anaplan\'s Integration API' + (d && d.login === 'token' ? ', with your API token.' : '.');
  return how + ' Checks never overlap. Available: Anaplan reports the model "Open". Busy: it names a running ' +
    'step - a process, import, export or another user\'s change - the cause of "Model is busy". Updating: a ' +
    'change being saved, usually brief.' + (d && d.login !== 'session'
      ? ' Locked / Offline: the API refused the model as locked (423) or offline (424).' : '') +
    ' Times are in your time zone.';
}

renderPage({
  page: 'lock_monitor',
  placeholder: 'Search by status, step or task...',
  tabs: [
    {
      label: 'Timeline',
      heading: 'Timeline',
      top: top,
      note: note,
      rows: periods,
      cols: 'grid-cols-12',
      headers: [{ label: 'From', cls: 'col-span-3', sort: function (r) { return r.from; } },
                { label: 'Duration', cls: 'col-span-2', sort: function (r) { return r.ms; } },
                { label: 'Status', cls: 'col-span-3', sort: function (r) { return r.status; } },
                { label: 'Anaplan says', cls: 'ia-span-4', sort: function (r) { return r.step; } }],
      key: function (r) { return r.status + ' ' + says(r) + ' ' + detail(r); },
      cells: function (r) {
        return [
          stackCell([clock(r.from), 'to ' + clock(r.to)], 'col-span-3 ia-num'),
          stackCell([dur(r.ms), r.checks + (r.checks === 1 ? ' check' : ' checks')], 'col-span-2'),
          statusCell(r.status, 'col-span-3'),
          // Reply time only where it matters - a second or more.
          stackCell([says(r), r.slowest >= 1000 && 'Slowest reply ' + reply(r.slowest), detail(r)], 'ia-span-4')
        ];
      },
      csvRow: function (r) {
        return { From: stamp(r.from), To: stamp(r.to), DurationSeconds: Math.round(r.ms / 1000), Status: r.status,
                 CurrentStep: r.step, Progress: pct(r.progress), Tooltip: localTip(r.tooltip, r.from),
                 TooltipAsSent: r.tooltip, TaskId: r.taskId,
                 TaskType: r.type, Checks: r.checks, SlowestReplyMs: r.slowest, Error: r.err };
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
                { label: 'Anaplan says', cls: 'ia-span-5', sort: function (r) { return r.step; } },
                { label: 'Reply', cls: 'col-span-2', sort: function (r) { return r.err ? null : r.ms; } }],
      key: function (r) { return clock(r.t) + ' ' + r.status + ' ' + says(r) + ' ' + detail(r); },
      cells: function (r) {
        return [
          textCell(clock(r.t), 'col-span-2 text-sm text-foreground ia-num'),
          statusCell(r.status, 'col-span-3'),
          stackCell([says(r), detail(r)], 'ia-span-5'),
          textCell(r.err ? '–' : reply(r.ms), 'col-span-2 text-sm text-muted-foreground ia-num')
        ];
      },
      csvRow: function (r) {
        return { Time: stamp(r.t), Status: r.status, CurrentStep: r.step, Progress: pct(r.progress),
                 Tooltip: localTip(r.tooltip, r.t), TooltipAsSent: r.tooltip, TaskId: r.taskId, TaskType: r.type,
                 ReplyMs: r.ms, HTTP: r.http || '',
                 Error: r.err };
      },
      filename: 'model-lock-checks.csv'
    }
  ]
});

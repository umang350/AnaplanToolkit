/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, csvText, runPause, runLead, runWait, runStep, runLogRows, runLogSummary, saveFile } from './sv_shared.js';

/* Create Modules - new modules and line items from a CSV of Module, Line Item and
   Applies To. Gathered by IA_gcm() in content-scripts/inner.js, as
   {mode, model, modelId, at, rows, modules, lineItems, created, stopped, calls}:

     mode      "check" (nothing created yet) or "create" (a run happened)
     rows[]    one per module (kind "module", with its Applies To) and one per line
               item (kind "item"): line (its CSV row), module, name, applies, before,
               status (ready / skip / exists / queued / created / failed), why
     modules   how many new modules are ready; lineItems how many line items
     running / paused / calls / partial / stopped   as in Delete Modules

   Like Delete Line Items it asks before changing anything (the number of things to
   create typed in) and posts ia_dl_delete / ia_dl_pause / ia_dl_pick to the panel;
   the report engine checks every row again before creating it. */

/* One view file serves two tabs: create_line_items.html loads this too and only adds line items to modules that exist. */
var ITEMS = /create_line_items/.test(location.pathname), PAGE = ITEMS ? 'create_line_items' : 'create_modules';

var STATUS = {
  ready: ['Ready to create', 'warn'],
  queued: ['Waiting', 'gap'],
  exists: ['Already there', 'soft'],
  skip: ['Skipped', 'gap'],
  created: ['Created', 'ok'],
  partial: ['Created - check', 'bad'],
  failed: ['Not created', 'bad']
};

function rowsOf(d) { return (d && d.rows) || []; }
function only(st) { return function (d) { return rowsOf(d).filter(function (r) { return st.indexOf(r.status) >= 0; }); }; }
function count(d, st) { return only(st)(d).length; }
function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); }
function kinds(rows) {
  var m = rows.filter(function (r) { return r.kind === 'module'; }).length, i = rows.length - m;
  return plural(m, 'module', 'modules') + ', ' + plural(i, 'line item', 'line items');
}

function csvRow(r) {
  return { Row: r.line, Module: r.module, LineItem: r.name, AppliesTo: r.applies || '', Before: r.before || '',
           Formula: r.formula || '', Format: r.format || '', Status: (STATUS[r.status] || [r.status])[0], Reason: r.why };
}

function callsText(d) {
  var c = d.calls;
  if (!c || !c.sent) return '';
  return ' · ' + plural(c.sent, 'call', 'calls') + ' to Anaplan (' + (c.applied || 0).toLocaleString() + ' applied, ' +
    (c.refused || 0).toLocaleString() + ' refused)';
}

/* Time Anaplan took, from the run's log: total and the slowest call (the whole log is in Export log). */
function timeText(d) {
  if (!d.log || !d.log.length) return '';
  var s = runLogSummary(d.log), dur = function (ms) {
    var x = Math.round(ms / 1000);
    return x < 60 ? x + 's' : Math.floor(x / 60) + 'm ' + String(x % 60).padStart(2, '0') + 's';
  };
  return s.calls ? ' · Anaplan took ' + dur(s.ms) + ', slowest call ' + dur(s.slowest) +
    (s.slow ? ', ' + plural(s.slow, 'call over a minute', 'calls over a minute') : '') : '';
}

function button(text, cls) {
  var b = el('button', cls || 'ia-dl-btn', text);
  b.type = 'button';
  return b;
}

function stamp(t) {
  var d = new Date(t || Date.now()), p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function logName(d) {
  return 'anaplan-create-modules-' + String(d.model || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) +
    '-' + stamp(d.at) + '-log.csv';
}
function saveLog(d) {
  var rows = runLogRows(d && d.log);
  if (rows.length) saveFile(csvText(rows), logName(d));
}

function saveReport(d) {
  var rows = rowsOf(d);
  if (!rows.length) return;
  saveLog(d);
  var url = URL.createObjectURL(new Blob([csvText(rows.map(csvRow))], { type: 'text/csv;charset=utf-8;' })),
      a = document.createElement('a');
  a.href = url;
  a.download = 'anaplan-create-modules-' + String(d.model || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) +
    '-' + stamp(d.at) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 6e4);
}

function pickButton() {
  var b = button('Choose another CSV');
  b.addEventListener('click', function () {
    window.parent.postMessage({ type: 'ia_dl_pick' }, location.origin);
  });
  return b;
}

/* Ask before creating: the number of modules and line items has to be typed in. */
function confirmBox(d) {
  var ready = only(['ready'])(d), n = ready.length,
      box = el('div', 'ia-dli-confirm'),
      open = button('Create ' + plural(n, 'item', 'items') + '…', 'ia-dl-btn ia-danger');
  box.appendChild(open);
  open.addEventListener('click', function () {
    var form = el('div', 'ia-dli-form'), input = el('input', 'ia-dli-input'),
        go = button('Create now', 'ia-dl-btn ia-danger'), cancel = button('Cancel');
    form.appendChild(el('p', 'text-sm text-foreground',
      'Create ' + kinds(ready) + (d.model ? ' in ' + d.model : '') + '? Anaplan applies each module ' +
      'with its line items all at once, and a refusal changes nothing. A line item\'s Formula and Format (Number or Boolean) are set afterwards, one request each; anything else stays at Anaplan\'s defaults.'));
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'Type ' + n + ' to confirm';
    input.setAttribute('aria-label', 'Type the number of items to confirm');
    go.disabled = true;
    input.addEventListener('input', function () { go.disabled = input.value.trim() !== String(n); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', function () {
      go.disabled = cancel.disabled = input.disabled = true;
      go.textContent = 'Creating…';
      var starting = el('p', 'text-xs text-muted-foreground', 'Starting - reading the model from Anaplan…');
      starting.id = 'ia-run-step';
      starting.setAttribute('role', 'status');
      form.appendChild(starting);
      /* Everything the check accepted goes back, in order; modules that already exist ride along so their
         line items are added to them. The engine checks each row again. */
      var send = rowsOf(d).filter(function (r) { return r.status === 'ready' || r.status === 'exists'; }).map(function (r) {
        return { line: r.line, module: r.module, name: r.name || '', appliesTo: r.applies || '', before: r.before || '',
          formula: r.formula || '', format: r.format || '' };
      });
      window.parent.postMessage({ type: 'ia_dl_delete', modelId: d.modelId, rows: send }, location.origin);
    });
    cancel.addEventListener('click', function () { form.replaceWith(open); });
    var bar = el('div', 'ia-dl');
    bar.appendChild(input);
    bar.appendChild(go);
    bar.appendChild(cancel);
    form.appendChild(bar);
    open.replaceWith(form);
    input.focus();
  });
  return box;
}

function top(d) {
  var box = el('div', 'space-y-2'), bar = el('div', 'ia-dl'), skip = count(d, ['skip']), line, wait = null;
  if (d.mode === 'create' && d.running) {
    var pause = runPause(d), save = button('Save report now'), todo = count(d, ['created', 'partial', 'failed', 'queued']);
    wait = runWait(d);
    save.addEventListener('click', function () { saveReport(d); });
    bar.appendChild(pause);
    bar.appendChild(save);
    var logBtn = button('Export log');
    logBtn.addEventListener('click', function () { saveLog(d); });
    bar.appendChild(logBtn);
    line = runLead(d) + count(d, ['created', 'partial']).toLocaleString() + ' of ' + plural(todo, 'item', 'items') + ' created so far' +
      (count(d, ['failed']) ? ' · ' + count(d, ['failed']).toLocaleString() + ' refused' : '') + callsText(d);
  } else if (d.mode === 'create') {
    bar.appendChild(pickButton());
    if (d.log && d.log.length) {
      var logBtn2 = button('Export log');
      logBtn2.addEventListener('click', function () { saveLog(d); });
      bar.appendChild(logBtn2);
    }
    var made = only(['created', 'partial'])(d), bad = count(d, ['failed']);
    line = kinds(made) + ' created' + (bad ? ' · ' + bad.toLocaleString() + ' not created' : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped' : '') + callsText(d) + timeText(d);
  } else {
    bar.appendChild(pickButton());
    line = kinds(only(['ready'])(d)) + ' ready to create' + (d.model ? ' in ' + d.model : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped (see Skipped)' : '');
  }
  bar.appendChild(el('span', 'text-xs text-muted-foreground', line));
  box.appendChild(bar);
  if (d.mode === 'create' && d.running && !d.paused) box.appendChild(runStep());
  if (wait) box.appendChild(wait);
  if (d.stopped) box.appendChild(el('p', 'text-xs ia-error', d.stopped));
  if (d.partial) box.appendChild(el('p', 'text-xs ia-error', 'Saved mid-run - the run may have gone on since.'));
  if (d.mode === 'create' && !d.running && count(d, ['created', 'partial']))
    box.appendChild(el('p', 'text-xs text-muted-foreground',
      'Reload the Anaplan page to see the change; structure reports were cleared.'));
  if (d.mode !== 'create' && count(d, ['ready'])) box.appendChild(confirmBox(d));
  return box;
}

function statusCell(r) {
  var s = STATUS[r.status] || [r.status, ''], wrap = el('div', 'ia-span-4 min-w-0'), pill = el('span', 'ia-lk', s[0]);
  pill.dataset.lk = s[1];
  wrap.appendChild(pill);
  if (r.why) wrap.appendChild(el('p', 'text-xs text-muted-foreground', r.why));
  return wrap;
}

function tab(label, heading, rows, note) {
  return {
    label: label,
    heading: heading,
    note: note,
    top: function (d) { return top(d || {}); },
    rows: rows,
    max: 500,
    placeholder: 'Search by module, line item or status...',
    cols: 'grid-cols-12',
    headers: [{ label: 'Row', cls: 'ia-span-1', sort: function (r) { return r.line; } },
              { label: 'Module', cls: 'ia-span-3', sort: function (r) { return r.module; } },
              { label: 'Line item / applies to', cls: 'ia-span-4', sort: function (r) { return r.name || r.applies || ''; } },
              { label: 'Status', cls: 'ia-span-4', sort: function (r) { return (STATUS[r.status] || [r.status])[0]; } }],
    key: function (r) {
      return r.module + ' ' + r.name + ' ' + (r.applies || '') + ' ' + (STATUS[r.status] || [r.status])[0] + ' ' + r.why;
    },
    cells: function (r) {
      var m = textCell(r.module || '–', 'ia-span-3 text-sm text-foreground'),
          what = r.kind === 'module'
            ? textCell(r.applies ? 'Applies to: ' + r.applies : 'New module', 'ia-span-4 text-sm text-muted-foreground')
            : textCell((r.name || '–') + (r.format ? ' · ' + r.format : '') + (r.formula ? ' = ' + r.formula : ''), 'ia-span-4 text-sm text-foreground');
      return [textCell(String(r.line), 'ia-span-1 text-xs text-muted-foreground'), m, what, statusCell(r)];
    },
    csvRow: csvRow,
    filename: (ITEMS ? 'create-line-items-' : 'create-modules-') + label.toLowerCase().replace(/\s+/g, '-') + '.csv'
  };
}

renderPage({
  keepOnError: true,
  page: PAGE,
  placeholder: 'Search by module, line item or status...',
  counts: true,
  tabs: [
    tab('All', ITEMS ? 'Create Line Items' : 'Create Modules', rowsOf),
    tab('Ready', 'To create', only(['ready', 'queued', 'created', 'partial']),
      'New modules and line items that match the model. A create adds each module with its line items in one request.'),
    tab('Skipped', 'Skipped and not created', only(['skip', 'failed', 'exists', 'partial']),
      'Rows that won\'t be (or weren\'t) created, with the reason. Already there: the module exists, so only its line items are added.')
  ]
});

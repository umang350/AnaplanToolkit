/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell, csvText, runPause, runLead, runWait, runStep, runLogRows, runLogSummary, saveFile } from './sv_shared.js';

/* Delete Modules - whole modules from a CSV of module names and IDs. Gathered
   by IA_gdm() in content-scripts/inner.js, as
   {mode, model, modelId, at, rows, lineItems, deleted, stopped, calls}:

     mode      "check" (nothing deleted yet) or "delete" (a delete ran)
     rows[]    one per CSV row: line (its row, not counting the header), module,
               moduleId, items (its line items), status (ready / skip / inuse /
               queued / deleted / failed), why, order (its place in the plan)
     lineItems how many line items the ready modules hold
     running   set on the snapshots sent while a delete runs (ia_live)
     paused    on a running snapshot while the run waits (Pause)
     calls     delete requests sent so far: {sent, applied, refused}
     partial   a copy the worker kept mid-run
     stopped   why a delete ended early, if it did

   Like Delete Line Items it asks before deleting (the number of modules typed
   in), posts ia_dl_delete / ia_dl_pause / ia_dl_pick to the panel, and the
   report engine checks every module again before deleting it. */

var STATUS = {
  ready: ['Ready to delete', 'warn'],
  queued: ['Waiting', 'gap'],
  inuse: ['In use', 'soft'],
  skip: ['Skipped', 'gap'],
  deleted: ['Deleted', 'ok'],
  failed: ['Not deleted', 'bad'],
  gone: ['Already deleted', 'soft'],
  kept: ['Module kept', 'soft']
};

function rowsOf(d) { return (d && d.rows) || []; }
/* Modules a process runs an import or export of (read at Check): Anaplan keeps them, so they are listed with
   Skipped with the process named - beside the modules Anaplan actually refused. */
function procRows(d) {
  var seen = new Set(rowsOf(d).filter(function (r) { return r.status === 'failed'; }).map(function (r) { return r.moduleId; }));
  return (d && d.procMods || []).filter(function (m) { return !seen.has(m.id); }).map(function (m) {
    var by = m.by || [];
    return { line: '', module: m.name, moduleId: m.id, items: m.items, status: 'kept',
      why: 'Used by ' + by.slice(0, 3).map(function (b) {
        var via = b.via || [];
        return "Process '" + b.process + "'" + (via.length ? " (through '" + via[0] + "'" + (via.length > 1 ? ' +' + (via.length - 1) : '') + ')' : '');
      }).join(', ') + (by.length > 3 ? ' and ' + (by.length - 3) + ' more' : '') + ' - delete the process first' };
  });
}
function skippedOf(d) { return only(['skip', 'inuse', 'failed'])(d).concat(procRows(d)); }

function only(st) { return function (d) { return rowsOf(d).filter(function (r) { return st.indexOf(r.status) >= 0; }); }; }
function count(d, st) { return only(st)(d).length; }
function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); }
function items(rows) { return rows.reduce(function (a, r) { return a + (r.items || 0); }, 0); }

function csvRow(r) {
  return { Row: r.line, Module: r.module, ModuleId: r.moduleId, LineItems: r.items || '',
           Status: (STATUS[r.status] || [r.status])[0], Reason: r.why, Order: r.order || '' };
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
  return 'anaplan-delete-modules-' + String(d.model || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) +
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
  a.download = 'anaplan-delete-modules-' + String(d.model || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) +
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

/* Ask before deleting: the number of modules has to be typed in. */
function confirmBox(d) {
  var ready = only(['ready'])(d), inuse = only(['inuse'])(d), n = ready.length,
      box = el('div', 'ia-dli-confirm'),
      open = button('Delete ' + plural(n, 'module', 'modules') + '…', 'ia-dl-btn ia-danger');
  box.appendChild(open);
  open.addEventListener('click', function () {
    var form = el('div', 'ia-dli-form'), input = el('input', 'ia-dli-input'),
        go = button('Delete now', 'ia-dl-btn ia-danger'), cancel = button('Cancel'), tryBox = null;
    form.appendChild(el('p', 'text-sm text-foreground',
      'Delete ' + plural(n, 'module', 'modules') + ' (' + plural(items(ready), 'line item', 'line items') + ')' +
      (d.model ? ' from ' + d.model : '') + '? Line items, data and saved views go with them, ' +
      'and this can\'t be undone from here.'));
    if (inuse.length) {
      var lab = el('label', 'ia-dli-try');
      tryBox = el('input');
      tryBox.type = 'checkbox';
      tryBox.checked = true;   // the extension's reading of formulas; Anaplan decides and a refusal changes nothing
      lab.appendChild(tryBox);
      lab.appendChild(document.createTextNode(' Also try the ' + plural(inuse.length, 'module', 'modules') +
        ' marked In use - they go last, and Anaplan decides (a refusal changes nothing)'));
      form.appendChild(lab);
    }
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'Type ' + n + ' to confirm';
    input.setAttribute('aria-label', 'Type the number of modules to confirm');
    go.disabled = true;
    input.addEventListener('input', function () { go.disabled = input.value.trim() !== String(n); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', function () {
      go.disabled = cancel.disabled = input.disabled = true;
      go.textContent = 'Deleting…';
      /* Until the run's first report arrives (it reads the whole model first, which takes a while on a large
         one) say what it is doing; the step text is filled in from the engine's progress (renderPage). */
      var starting = el('p', 'text-xs text-muted-foreground', 'Starting - reading the model from Anaplan…');
      starting.id = 'ia-run-step';
      starting.setAttribute('role', 'status');
      form.appendChild(starting);
      var all = tryBox && tryBox.checked ? ready.concat(inuse) : ready;
      if (tryBox) tryBox.disabled = true;
      window.parent.postMessage({ type: 'ia_dl_delete', modelId: d.modelId, tryInUse: !!(tryBox && tryBox.checked),
        rows: all.map(function (r) { return { line: r.line, module: r.module, moduleId: r.moduleId }; }) }, location.origin);
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
  var box = el('div', 'space-y-2'), bar = el('div', 'ia-dl'), all = rowsOf(d), skip = count(d, ['skip']), line, wait = null;
  if (d.mode === 'delete' && d.running) {
    var pause = runPause(d), save = button('Save report now'), todo = count(d, ['deleted', 'failed', 'queued']);
    wait = runWait(d);
    save.addEventListener('click', function () { saveReport(d); });
    bar.appendChild(pause);
    bar.appendChild(save);
    var logBtn = button('Export log');
    logBtn.addEventListener('click', function () { saveLog(d); });
    bar.appendChild(logBtn);
    line = runLead(d) + count(d, ['deleted']).toLocaleString() + ' of ' +
      plural(todo, 'module', 'modules') + ' deleted so far' +
      (count(d, ['failed']) ? ' · ' + count(d, ['failed']).toLocaleString() + ' refused' : '') +
      callsText(d);
  } else if (d.mode === 'delete') {
    bar.appendChild(pickButton());
    if (d.log && d.log.length) {
      var logBtn2 = button('Export log');
      logBtn2.addEventListener('click', function () { saveLog(d); });
      bar.appendChild(logBtn2);
    }
    var gone = only(['deleted'])(d), kept = count(d, ['failed']);
    line = plural(gone.length, 'module', 'modules') + ' deleted (' + plural(items(gone), 'line item', 'line items') + ')' +
      (kept ? ' · ' + kept.toLocaleString() + ' not deleted' : '') +
      (count(d, ['inuse']) ? ' · ' + count(d, ['inuse']).toLocaleString() + ' left (in use)' : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped' : '') + callsText(d) + timeText(d);
  } else {
    bar.appendChild(pickButton());
    var ready = count(d, ['ready']), used = count(d, ['inuse']);
    line = ready.toLocaleString() + ' of ' + plural(all.length, 'row', 'rows') + ' ready to delete' +
      (d.model ? ' in ' + d.model : '') + ' (' + plural(d.lineItems || 0, 'line item', 'line items') + ')' +
      (used ? ' · ' + used.toLocaleString() + ' in use by modules outside the CSV' : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped' : '') + (used || skip ? ' (see Skipped)' : '');
  }
  bar.appendChild(el('span', 'text-xs text-muted-foreground', line));
  box.appendChild(bar);
  if (d.mode === 'delete' && d.running && !d.paused) box.appendChild(runStep());
  if (wait) box.appendChild(wait);
  if (d.stopped) box.appendChild(el('p', 'text-xs ia-error', d.stopped));
  if (d.partial) box.appendChild(el('p', 'text-xs ia-error',
    'Saved mid-run - the run may have gone on since.'));
  if (d.mode === 'delete' && !d.running && count(d, ['deleted']))
    box.appendChild(el('p', 'text-xs text-muted-foreground',
      'Reload the Anaplan page to see the change; structure reports were cleared.'));
  if (d.mode !== 'delete' && count(d, ['ready'])) box.appendChild(confirmBox(d));
  return box;
}

function statusCell(r) {
  var s = STATUS[r.status] || [r.status, ''], wrap = el('div', 'ia-span-5 min-w-0'), pill = el('span', 'ia-lk', s[0]);
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
    placeholder: 'Search by module, ID or status...',
    cols: 'grid-cols-12',
    headers: [{ label: 'Row', cls: 'ia-span-1', sort: function (r) { return r.line; } },
              { label: 'Module', cls: 'ia-span-4', sort: function (r) { return r.module; } },
              { label: 'Line items', cls: 'col-span-2', sort: function (r) { return r.items || 0; } },
              { label: 'Status', cls: 'ia-span-5', sort: function (r) { return (STATUS[r.status] || [r.status])[0]; } }],
    key: function (r) {
      return r.module + ' ' + r.moduleId + ' ' + (STATUS[r.status] || [r.status])[0] + ' ' + r.why;
    },
    cells: function (r) {
      var m = r.moduleId ? idCell(r.module || '–', r.moduleId) : textCell(r.module || '–', 'text-sm text-foreground');
      m.classList.add('ia-span-4');
      return [
        textCell(String(r.line), 'ia-span-1 text-xs text-muted-foreground'),
        m,
        textCell(r.items ? Number(r.items).toLocaleString() : '–', 'col-span-2 text-sm text-foreground'),
        statusCell(r)
      ];
    },
    csvRow: csvRow,
    filename: 'delete-modules-' + label.toLowerCase().replace(/\s+/g, '-') + '.csv'
  };
}

renderPage({
  keepOnError: true,
  page: 'delete_modules',
  placeholder: 'Search by module, ID or status...',
  counts: true,
  tabs: [
    tab('All', 'Delete Modules', rowsOf),
    tab('Ready', 'Modules to delete', only(['ready', 'queued', 'deleted']),
      'Modules whose ID and name match the model. A delete removes these, each with everything in it.'),
    tab('Skipped', 'Skipped and not deleted', skippedOf,
      'Rows that won\'t be (or weren\'t) deleted, with the reason. In use: a line item in a module that isn\'t in the CSV ' +
      'uses one of the module\'s line items, so Anaplan would refuse it - add that module to the CSV, or leave this one.')
  ]
});

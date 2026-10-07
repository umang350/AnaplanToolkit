/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell, csvText } from './sv_shared.js';

/* Delete Line Items - the one view that changes the model. Gathered by
   IA_gdl() in content-scripts/inner.js from the CSV chosen in the panel, as
   {mode, model, modelId, at, modules, rows, deleted, stopped}:

     mode      "check" (nothing deleted yet) or "delete" (a delete ran)
     rows[]    one per CSV row: line (its row, not counting the header), module,
               name, id, moduleId, status (ready / skip / inuse / queued /
               deleted / failed), why, and order (its place in the planned
               deletion order)
     groups    how many requests the plan makes (one per module)
     running   set on the snapshots sent while a delete runs (ia_live), which
               redraw the report in place
     paused    on a running snapshot while the run waits (Pause)
     calls     delete requests sent so far: {sent, applied, refused}
     autosave  minutes between automatic saves of the report (0 = off)
     partial   a copy the worker kept mid-run (at most once a minute) - what
               the panel shows if it was closed before the run ended
     stopped   why a delete ended early, if it did

   After a check, the top of the report asks before deleting: the button
   opens a confirmation that wants the number of line items typed in. Only
   the rows the check found are sent back (ia_dl_delete to the panel), and the
   report engine checks each again against Anaplan before deleting it.

   While a delete runs the report can pause it (ia_dl_pause to the panel; it
   takes effect between requests) and save itself as a CSV: on request, and -
   when the confirmation's auto-save option is on - every `autosave` minutes
   and once more when the run ends. Saving goes through the optional
   `downloads` permission (asked for when the option is ticked) to one file per
   run, overwritten each time; without it, an ordinary download. Auto-save
   needs this report open in the panel. */

var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
var AUTOSAVE = [5, 10, 20, 30], AUTOSAVE_OPT = 'ia_dl_autosave';

var STATUS = {
  ready: ['Ready to delete', 'warn'],
  queued: ['Waiting', 'gap'],
  inuse: ['In use', 'soft'],
  skip: ['Skipped', 'gap'],
  deleted: ['Deleted', 'ok'],
  failed: ['Not deleted', 'bad']
};

function rowsOf(d) { return (d && d.rows) || []; }

function csvRow(r) {
  return { Row: r.line, Module: r.module, ModuleId: r.moduleId, LineItem: r.name, LineItemId: r.id,
           Status: (STATUS[r.status] || [r.status])[0], Reason: r.why, Order: r.order || '' };
}

function stamp(t) {
  var d = new Date(t || Date.now()), p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

// One file per run (named after its start), overwritten by each save.
function fileName(d) {
  var m = String(d.model || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'model';
  return 'anaplan-delete-line-items-' + m + '-' + stamp(d.at) + '.csv';
}

function saveReport(d) {
  var rows = rowsOf(d);
  if (!rows.length) return;
  var url = URL.createObjectURL(new Blob([csvText(rows.map(csvRow))], { type: 'text/csv;charset=utf-8;' })),
      name = fileName(d), done = function () { setTimeout(function () { URL.revokeObjectURL(url); }, 6e4); },
      plain = function () {
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        done();
      };
  if (api && api.downloads && api.downloads.download)
    Promise.resolve(api.downloads.download({ url: url, filename: name, conflictAction: 'overwrite', saveAs: false }))
      .then(done, plain);
  else plain();
}

/* Auto-save. A report opened mid-run waits for the next slot rather than
   saving straight away; the end-of-run save happens once per run (remembered
   in this browser, as the finished report is served again whenever the view
   reloads). */
var auto = { run: 0, slot: 0 };
function autoSave(d) {
  if (!d || d.mode !== 'delete' || !d.autosave || d.partial) return;
  var every = d.autosave * 6e4, slot = Math.floor((Date.now() - d.at) / every);
  if (auto.run !== d.at) { auto.run = d.at; auto.slot = slot; }
  if (d.running) {
    if (slot > auto.slot) { auto.slot = slot; saveReport(d); }
    return;
  }
  var k = 'ia_dl_final:' + d.at;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (e) {}
  saveReport(d);
}
// Not when Summary's Download all imports this module just for its columns.
if (!globalThis.IA_COLLECT) try {
  api.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'delete_line_items_data') autoSave(msg.data);
  });
} catch (e) { /* not in an extension page */ }
function only(st) { return function (d) { return rowsOf(d).filter(function (r) { return st.indexOf(r.status) >= 0; }); }; }
function count(d, st) { return only(st)(d).length; }
function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); }

/* Delete requests sent to Anaplan so far (calls on the run's data): several
   modules go in one request, and a refused one comes back small and fast. */
function callsText(d) {
  var c = d.calls;
  if (!c || !c.sent) return '';
  return ' · ' + plural(c.sent, 'call', 'calls') + ' to Anaplan (' + (c.applied || 0).toLocaleString() + ' applied, ' +
    (c.refused || 0).toLocaleString() + ' refused)';
}

function modulesOf(rows) {
  return new Set(rows.map(function (r) { return r.moduleId || r.module; })).size;
}

function button(text, cls) {
  var b = el('button', cls || 'ia-dl-btn', text);
  b.type = 'button';
  return b;
}

function pickButton() {
  var b = button('Choose another CSV');
  b.addEventListener('click', function () {
    window.parent.postMessage({ type: 'ia_dl_pick' }, location.origin);
  });
  return b;
}

/* Ask before deleting: the number of line items has to be typed in, so a stray
   click (or a report checked against a different CSV) can't start it. */
function confirmBox(d) {
  var ready = only(['ready'])(d), inuse = only(['inuse'])(d), n = ready.length,
      box = el('div', 'ia-dli-confirm'),
      open = button('Delete ' + plural(n, 'line item', 'line items') + '…', 'ia-dl-btn ia-danger');
  box.appendChild(open);
  open.addEventListener('click', function () {
    var form = el('div', 'ia-dli-form'),
        input = el('input', 'ia-dli-input'),
        go = button('Delete now', 'ia-dl-btn ia-danger'),
        cancel = button('Cancel');
    var tryBox = null;
    form.appendChild(el('p', 'text-sm text-foreground',
      'Delete ' + plural(n, 'line item', 'line items') + ' from ' + plural(modulesOf(ready), 'module', 'modules') +
      (d.model ? ' in ' + d.model : '') + '? Their data is deleted with them. ' +
      'This can\'t be undone from here - only by restoring the model from Anaplan\'s History.'));
    form.appendChild(el('p', 'text-xs text-muted-foreground',
      'Whole modules, up to 200 line items per request, in an order worked out from the formulas so nothing is deleted while a formula ' +
      'still uses it. A module whose line items depend on another module\'s in both directions is split only where it has to be.'));
    if (inuse.length) {
      var lab = el('label', 'ia-dli-try');
      tryBox = el('input');
      tryBox.type = 'checkbox';
      lab.appendChild(tryBox);
      lab.appendChild(document.createTextNode(' Also try the ' + plural(inuse.length, 'line item', 'line items') +
        ' marked In use (Anaplan will most likely refuse them; they go last)'));
      form.appendChild(lab);
    }
    var keep = { on: true, every: 10 };
    try { var o = JSON.parse(localStorage.getItem(AUTOSAVE_OPT) || 'null'); if (o) keep = o; } catch (e) {}
    var saveLab = el('label', 'ia-dli-try'), saveBox = el('input'), every = el('select', 'ia-dli-every');
    saveBox.type = 'checkbox';
    saveBox.checked = !!keep.on;
    AUTOSAVE.forEach(function (m) {
      var op = el('option', null, m + ' minutes');
      op.value = String(m);
      every.appendChild(op);
    });
    every.value = String(AUTOSAVE.indexOf(+keep.every) >= 0 ? keep.every : 10);
    saveLab.appendChild(saveBox);
    saveLab.appendChild(document.createTextNode(' Save the report to Downloads every '));
    saveLab.appendChild(every);
    saveLab.appendChild(document.createTextNode(' while it runs, and when it ends (keep this panel open)'));
    form.appendChild(saveLab);
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'Type ' + n + ' to confirm';
    input.setAttribute('aria-label', 'Type the number of line items to confirm');
    go.disabled = true;
    input.addEventListener('input', function () { go.disabled = input.value.trim() !== String(n); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', function () {
      var mins = saveBox.checked ? +every.value : 0;
      try { localStorage.setItem(AUTOSAVE_OPT, JSON.stringify({ on: saveBox.checked, every: +every.value })); } catch (e) {}
      /* Asked for here, inside the click: browsers only grant a permission
         from a user's action. Refused or unavailable, saving falls back to an
         ordinary download. */
      if (mins && api && api.permissions && api.permissions.request)
        try { Promise.resolve(api.permissions.request({ permissions: ['downloads'] })).catch(function () {}); } catch (e) {}
      saveBox.disabled = every.disabled = true;
      go.disabled = cancel.disabled = input.disabled = true;
      go.textContent = 'Deleting…';
      var all = tryBox && tryBox.checked ? ready.concat(inuse) : ready;
      if (tryBox) tryBox.disabled = true;
      window.parent.postMessage({ type: 'ia_dl_delete', modelId: d.modelId, tryInUse: !!(tryBox && tryBox.checked), autosave: mins,
        rows: all.map(function (r) { return { line: r.line, module: r.module, name: r.name, id: r.id }; }) },
        location.origin);
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
  var box = el('div', 'space-y-2'), bar = el('div', 'ia-dl'), all = rowsOf(d),
      skip = count(d, ['skip']), line;
  if (d.mode === 'delete' && d.running) {
    var done = count(d, ['deleted']), todo = count(d, ['deleted', 'failed', 'queued']),
        pause = button(d.paused ? 'Resume' : 'Pause', d.paused ? 'ia-dl-btn ia-danger' : 'ia-dl-btn'),
        save = button('Save report now');
    pause.addEventListener('click', function () {
      pause.disabled = true;
      pause.textContent = d.paused ? 'Resuming…' : 'Pausing…';
      window.parent.postMessage({ type: 'ia_dl_pause', paused: !d.paused }, location.origin);
    });
    save.addEventListener('click', function () { saveReport(d); });
    bar.appendChild(pause);
    bar.appendChild(save);
    line = (d.paused ? 'Paused · ' : 'Deleting… ') + done.toLocaleString() + ' of ' +
      plural(todo, 'line item', 'line items') + ' deleted so far' +
      (count(d, ['failed']) ? ' · ' + count(d, ['failed']).toLocaleString() + ' refused (tried again while others are deleted)' : '') +
      callsText(d) +
      (d.paused ? '' : ' · Pause waits for the request already sent') +
      (d.autosave ? ' · saved to Downloads every ' + d.autosave + ' min' : '');
  } else if (d.mode === 'delete') {
    bar.appendChild(pickButton());
    var gone = count(d, ['deleted']), kept = count(d, ['failed']);
    line = plural(gone, 'line item', 'line items') + ' deleted from ' +
      plural(modulesOf(only(['deleted'])(d)), 'module', 'modules') +
      (kept ? ' · ' + kept.toLocaleString() + ' not deleted' : '') +
      (count(d, ['inuse']) ? ' · ' + count(d, ['inuse']).toLocaleString() + ' left (in use)' : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped' : '') + callsText(d);
  } else {
    bar.appendChild(pickButton());
    var ready = count(d, ['ready']), used = count(d, ['inuse']);
    line = ready.toLocaleString() + ' of ' + plural(all.length, 'row', 'rows') + ' ready to delete' +
      (d.model ? ' in ' + d.model : '') + (d.groups ? ' (' + plural(d.groups, 'module', 'modules') + ')' : '') +
      (used ? ' · ' + used.toLocaleString() + ' in use by formulas outside the CSV' : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped' : '') + (used || skip ? ' (see Skipped)' : '');
  }
  bar.appendChild(el('span', 'text-xs text-muted-foreground', line));
  box.appendChild(bar);
  if (d.stopped) box.appendChild(el('p', 'text-xs ia-error', d.stopped));
  if (d.partial) box.appendChild(el('p', 'text-xs ia-error',
    'This is the report as it was saved mid-run; the run may have gone on since. Check the CSV again to see what is left.'));
  if (d.mode === 'delete' && !d.running && count(d, ['deleted']))
    box.appendChild(el('p', 'text-xs text-muted-foreground',
      'Reload the Anaplan page to see the change. The Line Items, Modules, Filters and Line Items on Pages ' +
      'reports were cleared - get them again after reloading.'));
  if (d.mode !== 'delete' && count(d, ['ready'])) box.appendChild(confirmBox(d));
  return box;
}

function statusCell(r) {
  var s = STATUS[r.status] || [r.status, ''], wrap = el('div', 'col-span-3 min-w-0'),
      pill = el('span', 'ia-lk', s[0]);
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
    placeholder: 'Search by module, line item, ID or status...',
    cols: 'grid-cols-12',
    headers: [{ label: 'Row', cls: 'ia-span-1', sort: function (r) { return r.line; } },
              { label: 'Module', cls: 'col-span-3', sort: function (r) { return r.module; } },
              { label: 'Line Item', cls: 'ia-span-5', sort: function (r) { return r.name; } },
              { label: 'Status', cls: 'col-span-3', sort: function (r) { return (STATUS[r.status] || [r.status])[0]; } }],
    key: function (r) {
      return r.module + ' ' + r.name + ' ' + r.id + ' ' + (STATUS[r.status] || [r.status])[0] + ' ' + r.why;
    },
    cells: function (r) {
      var li = r.id ? idCell(r.name || '–', r.id) : textCell(r.name || '–', 'text-sm text-foreground');
      li.classList.add('ia-span-5');
      return [
        textCell(String(r.line), 'ia-span-1 text-xs text-muted-foreground'),
        textCell(r.module || '–', 'col-span-3 text-sm text-foreground'),
        li,
        statusCell(r)
      ];
    },
    csvRow: csvRow,
    filename: 'delete-line-items-' + label.toLowerCase().replace(/\s+/g, '-') + '.csv'
  };
}

renderPage({
  page: 'delete_line_items',
  placeholder: 'Search by module, line item, ID or status...',
  counts: true,
  tabs: [
    tab('All', 'Delete Line Items', rowsOf, 'Row is the line item\'s row in your CSV, not counting the header.'),
    tab('Matched', 'Matched line items', only(['ready', 'queued', 'deleted']),
      'Line items whose ID, module and name all match the model. A delete removes these and nothing else.'),
    tab('Skipped', 'Skipped and not deleted', only(['skip', 'inuse', 'failed']),
      'Rows that won\'t be (or weren\'t) deleted, with the reason. In use: a formula outside the CSV uses the line item ' +
      '(or uses one that does), so Anaplan would refuse it - add that line item to the CSV, or leave this one.')
  ]
});

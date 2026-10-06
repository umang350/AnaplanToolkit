/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell } from './sv_shared.js';

/* Delete Line Items - the one view that changes the model. Gathered by
   IA_gdl() in content-scripts/inner.js from the CSV chosen in the panel, as
   {mode, model, modelId, at, modules, rows, deleted, stopped}:

     mode      "check" (nothing deleted yet) or "delete" (a delete ran)
     rows[]    one per CSV row: line (its row, not counting the header), module,
               name, id, moduleId, status (ready / skip / queued / deleted /
               failed) and why
     running   set on the snapshots sent while a delete runs (ia_live), which
               redraw the report in place
     stopped   why a delete ended early, if it did

   After a check, the top of the report asks before deleting: the button
   opens a confirmation that wants the number of line items typed in. Only
   the rows the check found are sent back (ia_dl_delete to the panel), and the
   report engine checks each again against Anaplan before deleting it. */

var STATUS = {
  ready: ['Ready to delete', 'warn'],
  queued: ['Waiting', 'gap'],
  skip: ['Skipped', 'gap'],
  deleted: ['Deleted', 'ok'],
  failed: ['Not deleted', 'bad']
};

function rowsOf(d) { return (d && d.rows) || []; }
function only(st) { return function (d) { return rowsOf(d).filter(function (r) { return st.indexOf(r.status) >= 0; }); }; }
function count(d, st) { return only(st)(d).length; }
function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); }

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
  var ready = only(['ready'])(d), n = ready.length,
      box = el('div', 'ia-dli-confirm'),
      open = button('Delete ' + plural(n, 'line item', 'line items') + '…', 'ia-dl-btn ia-danger');
  box.appendChild(open);
  open.addEventListener('click', function () {
    var form = el('div', 'ia-dli-form'),
        input = el('input', 'ia-dli-input'),
        go = button('Delete now', 'ia-dl-btn ia-danger'),
        cancel = button('Cancel');
    form.appendChild(el('p', 'text-sm text-foreground',
      'Delete ' + plural(n, 'line item', 'line items') + ' from ' + plural(modulesOf(ready), 'module', 'modules') +
      (d.model ? ' in ' + d.model : '') + '? Their data is deleted with them. ' +
      'This can\'t be undone from here - only by restoring the model from Anaplan\'s History.'));
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'Type ' + n + ' to confirm';
    input.setAttribute('aria-label', 'Type the number of line items to confirm');
    go.disabled = true;
    input.addEventListener('input', function () { go.disabled = input.value.trim() !== String(n); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', function () {
      go.disabled = cancel.disabled = input.disabled = true;
      go.textContent = 'Deleting…';
      window.parent.postMessage({ type: 'ia_dl_delete', modelId: d.modelId,
        rows: ready.map(function (r) { return { line: r.line, module: r.module, name: r.name, id: r.id }; }) },
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
  bar.appendChild(pickButton());
  if (d.mode === 'delete' && d.running) {
    var done = count(d, ['deleted']), todo = count(d, ['deleted', 'failed', 'queued']);
    line = 'Deleting… ' + done.toLocaleString() + ' of ' + plural(todo, 'line item', 'line items') + ' deleted so far' +
      (count(d, ['failed']) ? ' · ' + count(d, ['failed']).toLocaleString() + ' refused (tried again while others are deleted)' : '') +
      ' · Stop (top right) ends the run after the current request';
  } else if (d.mode === 'delete') {
    var gone = count(d, ['deleted']), kept = count(d, ['failed']);
    line = plural(gone, 'line item', 'line items') + ' deleted from ' +
      plural(modulesOf(only(['deleted'])(d)), 'module', 'modules') +
      (kept ? ' · ' + kept.toLocaleString() + ' not deleted' : '') +
      (skip ? ' · ' + skip.toLocaleString() + ' skipped' : '');
  } else {
    var ready = count(d, ['ready']);
    line = ready.toLocaleString() + ' of ' + plural(all.length, 'row', 'rows') + ' match a line item' +
      (d.model ? ' in ' + d.model : '') + (skip ? ' · ' + skip.toLocaleString() + ' skipped (see why below)' : '');
  }
  bar.appendChild(el('span', 'text-xs text-muted-foreground', line));
  box.appendChild(bar);
  if (d.stopped) box.appendChild(el('p', 'text-xs ia-error', d.stopped));
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
    csvRow: function (r) {
      return { Row: r.line, Module: r.module, ModuleId: r.moduleId, LineItem: r.name, LineItemId: r.id,
               Status: (STATUS[r.status] || [r.status])[0], Reason: r.why };
    },
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
    tab('Skipped', 'Skipped and not deleted', only(['skip', 'failed']),
      'Rows that won\'t be (or weren\'t) deleted, with the reason.')
  ]
});

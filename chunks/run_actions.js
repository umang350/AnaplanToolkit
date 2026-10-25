/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell, csvText, runPause, runWait, runStep, runLogRows, runLogSummary, saveFile } from './sv_shared.js';

/* Run Actions - processes and other actions that need no uploaded file, run one after another
   from a CSV of Name and Id. Gathered by IA_gra() in content-scripts/inner.js, as
   {mode, model, modelId, at, rows, stopOnFail, ready, done, failed, stopped, calls}:

     mode      "check" (nothing has run) or "delete" (a run - the same word the Delete views
               use, since the panel's upload flow is shared)
     rows[]    one per CSV row: line, type, name, id, status (ready / skip / file / queued /
               running / done / failed / notrun), why (Anaplan's reason, or what the action
               reported), ms (how long it took), taskId
     stopOnFail  a failed action ends the run; off by default - the run carries on and only Stop ends it
     (download  asked of the run, not kept in the report: the files an export produces are downloaded)
     running   set on the snapshots sent while a run goes (ia_live)
     paused    on a running snapshot while the run waits (Pause)
     calls     requests sent so far: {sent, applied, refused}
     partial   a copy the worker kept mid-run
     stopped   why a run ended early, if it did

   Like the Structure views that change the model it asks before it runs (the number of actions
   typed in), posts ia_dl_delete / ia_dl_pause / ia_dl_pick to the panel, and the engine validates each
   action again just before starting it. */

var STATUS = {
  ready: ['Ready to run', 'warn'],
  queued: ['Waiting', 'gap'],
  running: ['Running', 'warn'],
  done: ['Done', 'ok'],
  failed: ['Failed', 'bad'],
  skip: ['Skipped', 'gap'],
  file: ['Needs a file', 'soft'],
  notrun: ['Not run', 'soft']
};
/* Anaplan's entity ids start with their kind (seen on a HAR: 112 import, 116 export, 118 process). */
var KINDS = { 112: 'Import', 116: 'Export', 118: 'Process' };

function rowsOf(d) { return (d && d.rows) || []; }
function only(st) { return function (d) { return rowsOf(d).filter(function (r) { return st.indexOf(r.status) >= 0; }); }; }
function count(d, st) { return only(st)(d).length; }
function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many); }
function kindOf(r) { return r.type || KINDS[String(r.id || '').replace(/\D/g, '').slice(0, 3)] || 'Action'; }
function bare(id) { var m = /(\d{9,})/.exec(String(id || '')); return m ? m[1] : String(id || ''); }
function dur(ms) {
  var x = Math.round(ms / 1000);
  return x < 60 ? x + 's' : Math.floor(x / 60) + 'm ' + String(x % 60).padStart(2, '0') + 's';
}

function csvRow(r) {
  return { Row: r.line, Action: r.name, Id: bare(r.id), Type: kindOf(r), Status: (STATUS[r.status] || [r.status])[0],
           Reason: r.why, Seconds: r.ms == null ? '' : Math.round(r.ms / 100) / 10 };
}

function callsText(d) {
  var c = d.calls;
  if (!c || !c.sent) return '';
  return ' · ' + plural(c.sent, 'call', 'calls') + ' to Anaplan (' + (c.refused || 0).toLocaleString() + ' refused)';
}

function timeText(d) {
  var ran = rowsOf(d).reduce(function (a, r) { return a + (r.ms || 0); }, 0);
  return ran ? ' · actions ran for ' + dur(ran) : '';
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
function baseName(d) {
  return 'anaplan-run-actions-' + String(d.model || 'model').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) + '-' + stamp(d.at);
}
function saveLog(d) {
  var rows = runLogRows(d && d.log);
  if (rows.length) saveFile(csvText(rows), baseName(d) + '-log.csv');
}
function saveReport(d) {
  var rows = rowsOf(d);
  if (!rows.length) return;
  saveLog(d);
  var url = URL.createObjectURL(new Blob([csvText(rows.map(csvRow))], { type: 'text/csv;charset=utf-8;' })),
      a = document.createElement('a');
  a.href = url;
  a.download = baseName(d) + '.csv';
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

/* Ask before running: the number of actions has to be typed in. */
function confirmBox(d) {
  var ready = only(['ready'])(d), n = ready.length,
      box = el('div', 'ia-dli-confirm'),
      open = button('Run ' + plural(n, 'action', 'actions') + '…', 'ia-dl-btn ia-danger');
  box.appendChild(open);
  open.addEventListener('click', function () {
    var form = el('div', 'ia-dli-form'), input = el('input', 'ia-dli-input'),
        go = button('Run now', 'ia-dl-btn ia-danger'), cancel = button('Cancel'),
        lab = el('label', 'ia-dli-try'), cont = el('input');
    form.appendChild(el('p', 'text-sm text-foreground',
      'Run ' + plural(n, 'action', 'actions') + (d.model ? ' in ' + d.model : '') + ', one after another, in the order listed? ' +
      'Processes, imports and exports change data and can\'t be undone from here. Leave the Anaplan page alone while it runs.'));
    cont.type = 'checkbox';
    cont.checked = false;   // a failed action does not stop the run unless asked; the Stop button always can
    lab.appendChild(cont);
    lab.appendChild(document.createTextNode(' Stop the run at the first failed action (otherwise it carries on with the next one; Stop ends it at any time)'));
    form.appendChild(lab);
    var dlab = el('label', 'ia-dli-try'), dl = el('input');
    dl.type = 'checkbox';
    dl.checked = true;
    dlab.appendChild(dl);
    dlab.appendChild(document.createTextNode(' Download the files that exports produce, as each action finishes (your browser may ask to allow several downloads)'));
    form.appendChild(dlab);
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = 'Type ' + n + ' to confirm';
    input.setAttribute('aria-label', 'Type the number of actions to confirm');
    go.disabled = true;
    input.addEventListener('input', function () { go.disabled = input.value.trim() !== String(n); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', function () {
      go.disabled = cancel.disabled = input.disabled = cont.disabled = dl.disabled = true;
      go.textContent = 'Starting…';
      var starting = el('p', 'text-xs text-muted-foreground', 'Starting…');
      starting.id = 'ia-run-step';
      starting.setAttribute('role', 'status');
      form.appendChild(starting);
      window.parent.postMessage({ type: 'ia_dl_delete', modelId: d.modelId, stopOnFail: cont.checked, download: dl.checked,
        rows: ready.map(function (r) { return { line: r.line, name: r.name, id: r.id, type: r.type }; }) }, location.origin);
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

function runLead(d) {
  return d.paused ? (d.flight ? 'Pausing · ' : 'Paused · ') : 'Running… ';
}

function top(d) {
  var box = el('div', 'space-y-2'), bar = el('div', 'ia-dl'), all = rowsOf(d), skip = count(d, ['skip', 'file']), line, wait = null;
  if (d.mode === 'delete' && d.running) {
    var pause = runPause(d), save = button('Save report now'), total = count(d, ['done', 'failed', 'queued', 'running', 'notrun']);
    wait = runWait(d);
    save.addEventListener('click', function () { saveReport(d); });
    bar.appendChild(pause);
    bar.appendChild(save);
    var logBtn = button('Export log');
    logBtn.addEventListener('click', function () { saveLog(d); });
    bar.appendChild(logBtn);
    line = runLead(d) + count(d, ['done']).toLocaleString() + ' of ' + plural(total, 'action', 'actions') + ' done' +
      (count(d, ['failed']) ? ' · ' + count(d, ['failed']).toLocaleString() + ' failed' : '') + callsText(d);
  } else if (d.mode === 'delete') {
    bar.appendChild(pickButton());
    if (d.log && d.log.length) {
      var logBtn2 = button('Export log');
      logBtn2.addEventListener('click', function () { saveLog(d); });
      bar.appendChild(logBtn2);
    }
    var failed = count(d, ['failed']), notrun = count(d, ['notrun']);
    line = plural(count(d, ['done']), 'action', 'actions') + ' done' + (failed ? ' · ' + failed.toLocaleString() + ' failed' : '') +
      (notrun ? ' · ' + notrun.toLocaleString() + ' not run' : '') + callsText(d) + timeText(d);
  } else {
    bar.appendChild(pickButton());
    line = count(d, ['ready']).toLocaleString() + ' of ' + plural(all.length, 'row', 'rows') + ' ready to run' +
      (d.model ? ' in ' + d.model : '') + (skip ? ' · ' + skip.toLocaleString() + ' skipped (see Skipped)' : '');
  }
  bar.appendChild(el('span', 'text-xs text-muted-foreground', line));
  box.appendChild(bar);
  if (d.mode === 'delete' && d.running && !d.paused) box.appendChild(runStep());
  if (wait) box.appendChild(wait);
  if (d.stopped) box.appendChild(el('p', 'text-xs ia-error', d.stopped));
  if (d.partial) box.appendChild(el('p', 'text-xs ia-error', 'Saved mid-run - the run may have gone on since.'));
  if (d.mode !== 'delete' && count(d, ['ready'])) box.appendChild(confirmBox(d));
  return box;
}

function statusCell(r) {
  var s = STATUS[r.status] || [r.status, ''], wrap = el('div', 'ia-span-5 min-w-0'), pill = el('span', 'ia-lk', s[0]);
  pill.dataset.lk = s[1];
  wrap.appendChild(pill);
  if (r.ms != null && (r.status === 'done' || r.status === 'failed')) wrap.appendChild(el('span', 'text-xs text-muted-foreground', ' ' + dur(r.ms)));
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
    placeholder: 'Search by action, ID or status...',
    cols: 'grid-cols-12',
    headers: [{ label: 'Row', cls: 'ia-span-1', sort: function (r) { return r.line; } },
              { label: 'Action', cls: 'ia-span-4', sort: function (r) { return r.name; } },
              { label: 'Type', cls: 'col-span-2', sort: function (r) { return kindOf(r); } },
              { label: 'Status', cls: 'ia-span-5', sort: function (r) { return (STATUS[r.status] || [r.status])[0]; } }],
    key: function (r) {
      return r.name + ' ' + r.id + ' ' + kindOf(r) + ' ' + (STATUS[r.status] || [r.status])[0] + ' ' + r.why;
    },
    cells: function (r) {
      var m = r.id ? idCell(r.name || bare(r.id), bare(r.id)) : textCell(r.name || '–', 'text-sm text-foreground');
      m.classList.add('ia-span-4');
      return [
        textCell(String(r.line), 'ia-span-1 text-xs text-muted-foreground'),
        m,
        textCell(kindOf(r), 'col-span-2 text-sm text-foreground'),
        statusCell(r)
      ];
    },
    csvRow: csvRow,
    filename: 'run-actions-' + label.toLowerCase().replace(/\s+/g, '-') + '.csv'
  };
}

renderPage({
  keepOnError: true,
  page: 'run_actions',
  placeholder: 'Search by action, ID or status...',
  counts: true,
  tabs: [
    tab('All', 'Run Actions', rowsOf),
    tab('Ready', 'Actions to run', only(['ready', 'queued', 'running', 'done', 'failed', 'notrun']),
      'Actions Anaplan validated: they exist in this model. They run in the order of the CSV.'),
    tab('Skipped', 'Skipped', only(['skip', 'file']),
      'Rows that won\'t run, with Anaplan\'s own reason for refusing them while validating.')
  ]
});

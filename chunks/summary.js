/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Summary - the view the side panel opens on.
 *
 * Two sources:
 *   summary_data   model facts and structure counts, gathered by inner.js from
 *                  the in-page model cache (no Anaplan calls, so it is instant)
 *   ia_overview    asked of background.js: which of the other reports are
 *                  cached for this model, when, and how many items each holds
 *
 * The overview is re-asked whenever the worker announces a state change
 * (ia_state / ia_busy are broadcast to every extension page), so the list
 * updates live as other tabs finish gathering. Clicking a report sends
 * ia_select, which the panel shell handles exactly like a keyboard shortcut.
 *
 * Styles are ia-* classes in views.css rather than Tailwind utilities: the
 * compiled stylesheet only contains the utilities the bundled views use.
 */
import { LOGO, el } from './sv_shared.js';
import { buildFiles, zip, save } from './export_all.js';

var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

// Same order and names as the panel's tab bar (VIEWS in sidepanel.js).
var REPORTS = [
  { page: 'actions', name: 'Actions', unit: null },
  { page: 'action_usages', name: 'Usages', unit: 'usages' },
  { page: 'process_steps', name: 'Process Steps', keys: [['steps', 'steps'], ['loose', 'not in a process']] },
  { page: 'pages', name: 'Modules', unit: 'modules' },
  { page: 'filter_items', name: 'Filters', unit: 'rows' },
  // pick: gathers only the pages chosen in its picker, so like live it is not
  // counted in "loaded" or run by Get all data.
  { page: 'page_line_items', name: 'Line Items on Pages', unit: 'rows', key: 'rows', pick: true },
  { page: 'sv_views', name: 'SV List', unit: 'saved views' },
  { page: 'sv_screens', name: 'SV Screens', unit: 'rows' },
  { page: 'sv_actions', name: 'SV Actions', unit: 'imports' },
  { page: 'sv_filter_items', name: 'SV Filters', unit: 'rows', off: true },
  { page: 'sv_line_items', name: 'SV Items', unit: 'rows', off: true },
  { page: 'modules', name: 'Module List', unit: 'modules', key: 'modules' },
  { page: 'line_items', name: 'Line Items', unit: 'line items', key: 'lineItems' },
  { page: 'lists', name: 'Lists', keys: [['lists', 'lists'], ['properties', 'properties']] },
  // upload: runs on a CSV chosen in the panel (and can delete), so it is not
  // counted in "loaded" or run by Get all data either.
  { page: 'delete_line_items', name: 'Delete Line Items', unit: 'rows', key: 'rows', upload: true },
  { page: 'revisions', name: 'Revision Tags', keys: [['revisions', 'tags'], ['applied', 'models applied to']] },
  // live: runs until stopped, so it is not counted in "loaded" or run by Get all data.
  { page: 'lock_monitor', name: 'Lock Monitor', unit: 'checks', key: 'samples', live: true },
  { page: 'workspace', name: 'Workspace', unit: 'models', key: 'models' },
  // solo: calls every workspace you can access, so it only runs when opened -
  // not counted in "loaded" or run by Get all data.
  { page: 'workspace_all', name: 'All Workspaces', unit: 'workspaces', key: 'workspaces', solo: true }
];
var ACTION_LISTS = [['processes', 'processes'], ['imports', 'imports'], ['exports', 'exports'],
                    ['actions', 'actions'], ['files', 'files']];

var STRUCTURE = [
  ['modules', 'Modules'], ['lineItems', 'Line items'], ['lists', 'Lists'],
  ['savedViews', 'Saved views'], ['actions', 'Actions'], ['imports', 'Imports'],
  ['versions', 'Versions'], ['functionalAreas', 'Functional areas'], ['dashboards', 'Dashboards'],
  ['listSubsets', 'List subsets'], ['lineItemSubsets', 'Line item subsets']
];

var mount = document.getElementById('app'),
    model = null, status = null, overview = null, asking = false, again = false,
    dl = { busy: false, note: '' }, getAll = { running: false };

/* --- formatting ----------------------------------------------------------- */

var nf = new Intl.NumberFormat();
function num(v) { return typeof v === 'number' && isFinite(v) ? nf.format(v) : '–'; }

// Anaplan holds these as a bare number or a small object; take the first number.
function firstNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && isFinite(+v)) return +v;
  if (v && typeof v === 'object') {
    for (var k in v) { var n = firstNumber(v[k]); if (n != null) return n; }
  }
  return null;
}

function cells(v) {
  var n = firstNumber(v);
  if (n == null) return '–';
  return new Intl.NumberFormat('en', { notation: 'compact', compactDisplay: 'long',
                                       maximumFractionDigits: 1 }).format(n);
}

// Bytes in binary units, which is what Anaplan's own "Model info" shows.
function bytes(v) {
  var n = firstNumber(v);
  if (n == null) return '–';
  var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(2) : n) + ' ' + u[i];
}

function raw(v) {
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function ago(ts) {
  var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  var h = Math.floor(s / 3600);
  return h + (h === 1 ? ' hour ago' : ' hours ago');
}

function sizeText(r, size) {
  if (size == null) return '';
  if (typeof size === 'number') return num(size) + ' ' + r.unit;
  if (r.key) return typeof size[r.key] === 'number' ? num(size[r.key]) + ' ' + r.unit : '';
  return (r.keys || ACTION_LISTS)
    .filter(function (a) { return typeof size[a[0]] === 'number'; })
    .map(function (a) { return num(size[a[0]]) + ' ' + a[1]; })
    .join(' · ');
}

/* --- pieces --------------------------------------------------------------- */

function copyable(value) {
  var b = el('button', 'ia-copy', value || '–');
  b.type = 'button';
  if (!value) { b.disabled = true; return b; }
  b.title = 'Copy';
  b.addEventListener('click', function () {
    navigator.clipboard.writeText(value).then(function () {
      b.dataset.copied = '1';
      setTimeout(function () { delete b.dataset.copied; }, 1200);
    }, function () {});
  });
  return b;
}

function field(label, valueNode, title) {
  var row = el('div', 'ia-field');
  row.appendChild(el('dt', null, label));
  var dd = el('dd');
  if (title) dd.title = title;
  dd.appendChild(typeof valueNode === 'string' ? document.createTextNode(valueNode) : valueNode);
  row.appendChild(dd);
  return row;
}

function section(title) {
  var s = el('section', 'ia-section');
  s.appendChild(el('h2', null, title));
  return s;
}

function modelCard() {
  var s = section('Model');
  if (!model) {
    s.appendChild(el('p', 'ia-note' + (status && status.error ? ' ia-error' : ''),
      status ? status.text : 'Reading model…'));
    return s;
  }
  // A refresh that failed after an earlier success: keep the old facts.
  if (status && status.error) s.appendChild(el('p', 'ia-note ia-error', status.text));
  s.appendChild(el('p', 'ia-title', model.modelName || 'Unnamed model'));
  if (model.workspaceName) s.appendChild(el('p', 'ia-sub', model.workspaceName));

  var dl = el('dl', 'ia-fields');
  dl.appendChild(field('Model ID', copyable(model.modelId)));
  dl.appendChild(field('Workspace ID', copyable(model.workspaceId)));
  if (model.customerId) dl.appendChild(field('Customer ID', copyable(model.customerId)));
  dl.appendChild(field('Cell count', cells(model.cellCount), raw(model.cellCount)));
  dl.appendChild(field('Model size', bytes(model.memory), raw(model.memory)));
  s.appendChild(dl);
  return s;
}

function structureCard() {
  var s = section('Structure');
  if (!model) { s.appendChild(el('p', 'ia-note', '–')); return s; }
  var grid = el('div', 'ia-stats'), c = model.counts || {};
  STRUCTURE.forEach(function (x) {
    var t = el('div', 'ia-stat');
    t.appendChild(el('span', 'ia-stat-n', num(c[x[0]])));
    t.appendChild(el('span', 'ia-stat-l', x[1]));
    grid.appendChild(t);
  });
  s.appendChild(grid);
  return s;
}

function reportsCard() {
  var s = section('Reports'), pages = overview && overview.pages || {};
  var on = REPORTS.filter(function (r) { return !r.off && !r.live && !r.pick && !r.upload && !r.solo; });
  var has = function (r) { return pages[r.page] && pages[r.page].ts; };
  var loaded = on.filter(has).length;
  s.querySelector('h2').appendChild(el('span', 'ia-h-count', loaded + ' / ' + on.length + ' loaded'));

  var list = el('ul', 'ia-reports');
  REPORTS.forEach(function (r) {
    var p = pages[r.page] || {}, li = el('li'), b = el('button', 'ia-report');
    b.type = 'button';
    b.dataset.state = r.off ? 'off' : p.busy ? 'busy' : p.ts ? 'loaded' : 'empty';
    if (r.off) b.disabled = true;
    else b.addEventListener('click', function () {
      api.runtime.sendMessage({ type: 'ia_select', page: r.page }).catch(function () {});
    });
    var head = el('span', 'ia-report-head');
    head.appendChild(el('span', 'ia-dot'));
    head.appendChild(el('span', 'ia-report-name', r.name));
    head.appendChild(el('span', 'ia-report-when',
      r.off ? 'Disabled - too slow' : p.busy ? (r.live ? 'Monitoring…' : 'Loading…') : p.ts ? ago(p.ts)
        : r.live ? 'Not run' : r.pick ? 'Choose pages' : r.upload ? 'Choose a CSV' : 'Not loaded'));
    b.appendChild(head);
    var size = p.ts && !r.off ? sizeText(r, p.size) : '';
    if (size) b.appendChild(el('span', 'ia-report-size', size));
    li.appendChild(b);
    list.appendChild(li);
  });
  s.appendChild(list);
  if (!overview) s.appendChild(el('p', 'ia-note', 'Checking…'));
  s.appendChild(actions(loaded, on.length, REPORTS.filter(has).length));
  return s;
}

/* Get all data + Download all, side by side. Get all data is run by the
   panel shell (getAll in sidepanel.js), one report after another; it tells
   us how far along it is (ia_getall_status), and the button becomes Stop. */
function actions(loaded, total, any) {
  var row = el('div', 'ia-dl'),
      g = el('button', 'ia-dl-btn', getAll.running ? 'Stop' : 'Get all data');
  g.type = 'button';
  g.disabled = !getAll.running && (!model || loaded >= total);
  g.title = getAll.running ? 'Stop getting data' : loaded >= total ? 'Every report is loaded'
    : 'Gather every report that is not loaded yet, one after another';
  g.addEventListener('click', function () {
    window.parent.postMessage({ type: getAll.running ? 'ia_getall_stop' : 'ia_getall' }, location.origin);
  });
  row.appendChild(g);
  downloadAll(row, any);
  if (getAll.running)
    row.appendChild(el('span', 'ia-note', 'Getting ' + (getAll.done + 1) + ' of ' + getAll.total +
                       (getAll.current ? ': ' + getAll.current : '') + '…'));
  return row;
}

/* "Download all": every loaded report's CSV files in one .zip, plus the model
   facts above as summary.csv (chunks/export_all.js). */
function downloadAll(wrap, loaded) {
  var b = el('button', 'ia-dl-btn', dl.busy ? 'Preparing…' : 'Download all as CSV (.zip)');
  b.type = 'button';
  b.disabled = dl.busy || !loaded;
  b.title = loaded ? 'Every loaded report\'s CSV files, zipped' : 'Load a report first';
  b.addEventListener('click', downloadAllNow);
  wrap.appendChild(b);
  if (dl.note) wrap.appendChild(el('span', 'ia-note' + (dl.error ? ' ia-error' : ''), dl.note));
}

function summaryRows() {
  if (!model) return [];
  var c = model.counts || {}, rows = [
    { Field: 'Model', Value: model.modelName || '' },
    { Field: 'Model ID', Value: model.modelId || '' },
    { Field: 'Workspace', Value: model.workspaceName || '' },
    { Field: 'Workspace ID', Value: model.workspaceId || '' },
    { Field: 'Customer ID', Value: model.customerId || '' },
    { Field: 'Cell count', Value: firstNumber(model.cellCount) ?? '' },
    { Field: 'Model size (bytes)', Value: firstNumber(model.memory) ?? '' }
  ];
  STRUCTURE.forEach(function (x) { rows.push({ Field: x[1], Value: c[x[0]] ?? '' }); });
  return rows;
}

function fileStamp() {
  var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}

function downloadAllNow() {
  if (dl.busy) return;
  dl = { busy: true, note: '' };
  render();
  api.runtime.sendMessage({ type: 'ia_dump' }).then(function (r) {
    if (!r || !r.pages) throw new Error((r && r.error) || 'The cached reports could not be read.');
    return buildFiles(r.pages, REPORTS.map(function (x) { return x.page; }),
                      [{ name: 'summary.csv', rows: summaryRows() }]);
  }).then(function (files) {
    if (!files.length) throw new Error('No loaded report has any rows to export.');
    return zip(files).then(function (blob) {
      var name = String((model && model.modelName) || 'model').replace(/[\\/:*?"<>|]+/g, '_').trim();
      save(blob, name + ' - Anaplan Toolkit ' + fileStamp() + '.zip');
      dl = { busy: false, note: files.length + ' files' };
    });
  }).catch(function (e) {
    dl = { busy: false, note: (e && e.message) || 'Download failed.', error: true };
  }).then(render);
}

function render() {
  var root = el('div', 'ia-summary'), bar = el('div', 'ia-bar'), img = el('img');
  img.alt = 'Anaplan Toolkit';
  img.src = LOGO;
  bar.appendChild(img);
  root.appendChild(bar);
  root.appendChild(modelCard());
  root.appendChild(structureCard());
  root.appendChild(reportsCard());
  mount.replaceChildren(root);
}

/* --- data ----------------------------------------------------------------- */

// One request in flight at a time; a burst of state changes collapses into a
// single follow-up rather than a request per message.
function askOverview() {
  if (asking) { again = true; return; }
  asking = true;
  api.runtime.sendMessage({ type: 'ia_overview' }).then(function (r) {
    if (r && r.pages) { overview = r; render(); }
  }, function () {}).then(function () {
    asking = false;
    if (again) { again = false; askOverview(); }
  });
}

try {
  api.runtime.onMessage.addListener(function (msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'summary_data') { model = msg.data || {}; status = null; render(); askOverview(); }
    else if (msg.type === 'ia_state' || msg.type === 'ia_busy') askOverview();
  });
} catch (e) { /* not in an extension page */ }

/* Load status comes from the panel shell, not from `error` broadcasts: the
   panel retries Summary while the model is still loading, and only it knows
   whether a failure is final (see startSummary() in sidepanel.js). */
window.addEventListener('message', function (e) {
  if (e.source !== window.parent || e.origin !== location.origin) return;
  if (e.data && e.data.type === 'ia_summary_status') { status = e.data.status || null; render(); }
  if (e.data && e.data.type === 'ia_getall_status') { getAll = e.data; render(); }
});

render();
askOverview();
// Keeps the "n min ago" labels honest.
setInterval(function () { if (overview) render(); }, 30000);

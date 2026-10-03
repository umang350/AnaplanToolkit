/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell } from './sv_shared.js';
import { nf, bytes, stateText, workspaces, allModels, percent, meterBar,
         modelCell, stateCell, csvRow } from './workspace_shared.js';

/* Workspace › All - every workspace the user can reach (IA_gwsa in
   content-scripts/inner.js), as two tabs:

     Workspaces  one row each: storage in use, allowance, % full, active models
     Models      every active (non-archived) model, one row each with its workspace

   Archived and deleted models are left out everywhere here: they don't count toward
   storage, and the list that names the workspaces doesn't carry them. A
   workspace whose summary Anaplan refused (`error`) has no storage figures and
   its models come from that list without sizes; the note names it and why. */

var current = '', here = '';

function prime(d) {
  current = (d && d.currentModelId) || '';
  here = (d && d.currentWorkspaceId) || '';
}

// Current workspace first, then by name.
function byWorkspace(a, b) {
  return (b.workspaceId === here) - (a.workspaceId === here) ||
    String(a.workspaceName).localeCompare(String(b.workspaceName));
}

function refusals(d) {
  var bad = workspaces(d).filter(function (w) { return w.error; });
  return bad.length
    ? ' No storage for ' + bad.map(function (w) { return (w.workspaceName || w.workspaceId) + ' (' + w.error + ')'; }).join(', ') +
      ' - Anaplan refused its summary, so its models come from the Models list without sizes.'
    : '';
}

/* --- Workspaces tab ------------------------------------------------------- */

// Totals across the workspaces whose storage is known.
function totals(d) {
  var ws = workspaces(d),
      known = ws.filter(function (w) { return percent(w) != null; }),
      used = known.reduce(function (s, w) { return s + w.contractual; }, 0),
      cap = known.reduce(function (s, w) { return s + w.allowance; }, 0),
      box = el('div', 'ia-ws'),
      head = el('div', 'ia-ws-head');
  head.appendChild(el('span', 'ia-ws-name', nf.format(ws.length) + (ws.length === 1 ? ' workspace' : ' workspaces')));
  if (cap) head.appendChild(el('span', 'ia-ws-pct', Math.floor(used / cap * 100) + '% full'));
  box.appendChild(head);
  box.appendChild(meterBar(cap ? used / cap * 100 : null));
  box.appendChild(el('p', 'ia-ws-line', bytes(used) + ' of ' + bytes(cap) + ' in use across ' +
    nf.format(known.length) + (known.length === ws.length ? '' : ' of ' + nf.format(ws.length)) +
    (known.length === 1 ? ' workspace' : ' workspaces') + ' · ' + nf.format(allModels(d).length) + ' active models'));
  var wrap = el('div', 'ia-ws-list');
  wrap.appendChild(box);
  return wrap;
}

function pctCell(w) {
  var pct = percent(w), wrap = el('div', 'col-span-2 min-w-0');
  wrap.appendChild(textCell(pct == null ? '–' : Math.floor(pct) + '%', 'text-sm text-foreground ia-num'));
  if (pct != null) wrap.appendChild(meterBar(pct, 'ia-meter-sm'));
  return wrap;
}

var WORKSPACES = {
  label: 'Workspaces',
  heading: 'Workspaces',
  note: function (d) { prime(d); return 'Storage in use counts active models only.' + refusals(d); },
  top: totals,
  placeholder: 'Search by workspace or ID...',
  // Each row carries its active-model count; cells don't see the data.
  rows: function (d) {
    prime(d);
    var n = {};
    allModels(d).forEach(function (m) { n[m.workspaceId] = (n[m.workspaceId] || 0) + 1; });
    return workspaces(d).map(function (w) { return Object.assign({ active: n[w.workspaceId] || 0 }, w); }).sort(byWorkspace);
  },
  cols: 'grid-cols-12',
  headers: [{ label: 'Workspace', cls: 'ia-span-4' }, { label: 'In use', cls: 'col-span-2' },
            { label: 'Allowance', cls: 'col-span-2' }, { label: 'Full', cls: 'col-span-2' },
            { label: 'Active models', cls: 'col-span-2' }],
  key: function (w) { return w.workspaceName + ' ' + w.workspaceId; },
  cells: function (w) {
    var name = el('div', 'ia-span-4 min-w-0'),
        title = el('p', 'text-sm text-foreground', w.workspaceName || w.workspaceId);
    if (w.workspaceId === here) title.appendChild(el('span', 'ia-tag', 'Current'));
    name.appendChild(title);
    name.appendChild(el('p', 'text-xs text-muted-foreground font-mono leading-none pt-0.5', w.workspaceId));
    if (w.error) name.appendChild(el('p', 'text-xs ia-error', 'Storage unavailable: ' + w.error));
    return [
      name,
      textCell(bytes(w.contractual), 'col-span-2 text-sm text-foreground ia-num'),
      textCell(bytes(w.allowance), 'col-span-2 text-sm text-muted-foreground ia-num'),
      pctCell(w),
      textCell(nf.format(w.active), 'col-span-2 text-sm text-muted-foreground ia-num')
    ];
  },
  csvRow: function (w) {
    var pct = percent(w);
    return {
      Workspace: w.workspaceName,
      'Workspace ID': w.workspaceId,
      'In use (bytes)': w.contractual,
      'In use': w.contractual == null ? '' : bytes(w.contractual),
      'Allowance (bytes)': w.allowance,
      Allowance: w.allowance == null ? '' : bytes(w.allowance),
      'Full %': pct == null ? '' : Math.floor(pct),
      'Active models': w.active,
      Note: w.error ? 'Storage unavailable: ' + w.error : ''
    };
  },
  filename: 'workspaces.csv'
};

/* --- Models tab ----------------------------------------------------------- */

var MODELS = {
  label: 'Models',
  heading: 'Active Models',
  note: function (d) { prime(d); return 'Active models in every workspace you can access.' + refusals(d); },
  placeholder: 'Search by workspace, model, state or ID...',
  rows: function (d) {
    prime(d);
    return allModels(d).slice().sort(function (a, b) {
      return byWorkspace(a, b) || (b.memory || 0) - (a.memory || 0) ||
        String(a.modelName).localeCompare(String(b.modelName));
    });
  },
  cols: 'grid-cols-12',
  headers: [{ label: 'Workspace', cls: 'col-span-3' }, { label: 'Model', cls: 'ia-span-4' },
            { label: 'State', cls: 'col-span-2' }, { label: 'Size', cls: 'col-span-3' }],
  key: function (r) {
    return r.workspaceName + ' ' + r.modelName + ' ' + stateText(r.state) + ' ' + r.modelId;
  },
  cells: function (r) {
    return [
      textCell(r.workspaceName || r.workspaceId, 'col-span-3 text-sm text-foreground'),
      modelCell(r, current),
      stateCell(r, 'col-span-2'),
      textCell(bytes(r.memory), 'col-span-3 text-sm text-foreground ia-num')
    ];
  },
  csvRow: csvRow,
  filename: 'all_workspace_models.csv'
};

renderPage({
  page: 'workspace_all',
  placeholder: 'Search...',
  tabs: [WORKSPACES, MODELS]
});

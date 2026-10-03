/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell } from './sv_shared.js';
import { nf, bytes, count, stateText, workspaces, allModels, percent, meterBar,
         modelCell, stateCell, csvRow } from './workspace_shared.js';

/* Workspace › Current - the models in the workspace this model is in, largest
   first, split Active / Archived, under the workspace's storage in use against
   its allowance. One cheap call (IA_gws in content-scripts/inner.js); the
   other workspaces are Workspace › All (chunks/workspace_all.js), gathered on
   their own because a workspace on another Anaplan server can take a while. */

var current = '';

function models(d) {
  current = (d && d.currentModelId) || '';
  return allModels(d);
}

function meter(w, rows) {
  var box = el('div', 'ia-ws'),
      pct = percent(w),
      archived = rows.filter(function (m) { return m.state === 'ARCHIVED'; }).length,
      open = rows.filter(function (m) { return m.open; }).length;

  var head = el('div', 'ia-ws-head');
  head.appendChild(el('span', 'ia-ws-name', w.workspaceName || w.workspaceId || 'Workspace'));
  if (pct != null) head.appendChild(el('span', 'ia-ws-pct', Math.floor(pct) + '% full'));
  box.appendChild(head);
  box.appendChild(meterBar(pct));
  box.appendChild(el('p', 'ia-ws-line', bytes(w.contractual) + ' of ' + bytes(w.allowance) + ' in use'));
  box.appendChild(el('p', 'ia-ws-line',
    nf.format(rows.length) + (rows.length === 1 ? ' model · ' : ' models · ') +
    nf.format(rows.length - archived) + ' active · ' + nf.format(archived) + ' archived' +
    (open ? ' · ' + nf.format(open) + ' open' : '') + (w.engine ? ' · ' + stateText(w.engine) : '')));
  return box;
}

function top(d) {
  var w = workspaces(d)[0];
  if (!w) return null;
  var wrap = el('div', 'ia-ws-list');
  wrap.appendChild(meter(w, models(d)));
  return wrap;
}

function table(label, heading, note, keep) {
  return {
    label: label,
    heading: heading,
    note: note,
    top: top,
    placeholder: 'Search by model, state or ID...',
    rows: function (d) { return models(d).filter(keep); },
    cols: 'grid-cols-12',
    headers: [{ label: 'Model', cls: 'ia-span-4' }, { label: 'State', cls: 'col-span-3' },
              { label: 'Size', cls: 'col-span-3' }, { label: 'Cells', cls: 'col-span-2' }],
    key: function (r) {
      return r.modelName + ' ' + stateText(r.state) + (r.open ? ' open' : '') + ' ' + r.modelId;
    },
    cells: function (r) {
      return [
        modelCell(r, current),
        stateCell(r),
        textCell(bytes(r.memory), 'col-span-3 text-sm text-foreground ia-num'),
        textCell(count(r.cellCount), 'col-span-2 text-sm text-muted-foreground ia-num')
      ];
    },
    csvRow: csvRow,
    filename: 'workspace_models.csv'
  };
}

renderPage({
  page: 'workspace',
  placeholder: 'Search by model, state or ID...',
  tabs: [
    table('Active', 'Active Models', 'Active models make up the workspace storage in use.',
          function (r) { return r.state !== 'ARCHIVED'; }),
    table('Archived', 'Archived Models', 'Archived models do not count toward workspace storage.',
          function (r) { return r.state === 'ARCHIVED'; })
  ]
});

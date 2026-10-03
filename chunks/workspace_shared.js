/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { el, textCell } from './sv_shared.js';

/* Shared by the two Workspace views: Current (chunks/workspace.js) and All
   (chunks/workspace_all.js). Both get data shaped by IA_wsData() in
   content-scripts/inner.js:

     workspaces[]  {workspaceId, workspaceName, size, allowance, contractual,
                    engine, modelCount, listed, error}   sizes in bytes
     models[]      {workspaceId, workspaceName, modelId, modelName, state,
                    open, memory, cellCount, unload, deletes}
     currentModelId, currentWorkspaceId

   "In use" is `contractual` (contractualWorkspaceSize), not `size`: Anaplan's
   own Model Management dialog reads "88% full (266.86 GB of 300 GB in use)"
   where contractual is 266.86 GB and size only 149.8 GB. Contractual matches
   the active (non-archived) models' sizes - archived models don't count. The
   percentage is floored, as Anaplan shows it. Styles are ia-* classes in
   views.css (the compiled CSS only has the bundled views' utilities). */

export var nf = new Intl.NumberFormat();
var compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// Binary units, two decimals from GB up, as Anaplan's dialog shows them
// (300 GB = 322122547200, "265.76 GB").
export function bytes(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '–';
  var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(i >= 3 ? 2 : 1) : n) + ' ' + u[i];
}

export function count(n) {
  return typeof n === 'number' && isFinite(n) ? compact.format(n) : '–';
}

// ARCHIVED -> Archived, PRODUCTION_MAINTENANCE -> Production maintenance
export function stateText(s) {
  s = String(s || '').toLowerCase().replace(/_/g, ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : '–';
}

function purgeText(ts) {
  var d = typeof ts === 'number' ? new Date(ts) : null;
  return d && !isNaN(d) ? 'Deleted · purged ' + d.toLocaleDateString() : 'Deleted';
}

export function workspaces(d) { return (d && Array.isArray(d.workspaces)) ? d.workspaces : []; }
export function allModels(d) { return (d && Array.isArray(d.models)) ? d.models : []; }

// Floored percent of the allowance in use, or null when either is unknown.
export function percent(w) {
  return typeof w.contractual === 'number' && typeof w.allowance === 'number' && w.allowance > 0
    ? w.contractual / w.allowance * 100 : null;
}

// The coloured bar: amber from 75%, red from 90%.
export function meterBar(pct, cls) {
  var bar = el('div', 'ia-meter' + (cls ? ' ' + cls : ''));
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', 'Workspace storage used');
  if (pct != null) {
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    var fill = el('i');
    fill.style.width = Math.min(100, pct) + '%';
    if (pct >= 90) fill.dataset.level = 'high';
    else if (pct >= 75) fill.dataset.level = 'warn';
    bar.appendChild(fill);
  }
  return bar;
}

export function modelCell(r, current, span) {
  var wrap = el('div', (span || 'ia-span-4') + ' min-w-0'),
      name = el('p', 'text-sm text-foreground', r.modelName || 'Unnamed');
  if (r.modelId && r.modelId === current) name.appendChild(el('span', 'ia-tag', 'This model'));
  wrap.appendChild(name);
  if (r.modelId) wrap.appendChild(el('p', 'text-xs text-muted-foreground font-mono leading-none pt-0.5', r.modelId));
  return wrap;
}

export function stateCell(r, span) {
  var wrap = el('div', (span || 'col-span-3') + ' min-w-0 ia-words');
  wrap.appendChild(textCell(stateText(r.state)));
  var extra = [];
  if (r.open) extra.push('Open');
  if (r.unload) extra.push('Marked for unload');
  if (r.deletes != null) extra.push(purgeText(r.deletes));
  if (extra.length) wrap.appendChild(el('p', 'text-xs text-muted-foreground', extra.join(' · ')));
  return wrap;
}

export function csvRow(r) {
  return {
    Workspace: r.workspaceName,
    'Workspace ID': r.workspaceId,
    Model: r.modelName,
    'Model ID': r.modelId,
    State: stateText(r.state),
    Open: r.open ? 'Yes' : 'No',
    'Size (bytes)': r.memory,
    Size: r.memory == null ? '' : bytes(r.memory),
    Cells: r.cellCount,
    'Marked for unload': r.unload ? 'Yes' : 'No',
    'Deletion expires': typeof r.deletes === 'number' ? new Date(r.deletes).toISOString() : ''
  };
}

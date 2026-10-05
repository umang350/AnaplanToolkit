/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, icon } from './sv_shared.js';

/* Actions & File IDs - every process, import, export, action and file with its
   ID (and an import's source ID), each one click to copy.

   Replaces the compiled Svelte view (chunks/actions-DpK-UuAO.js.retired, kept
   in the repo but not shipped), which drew every row of every list - with a
   copy-button component each - on the All tab and again on every keystroke,
   and hung the browser on large models. Its outside helpers went with it:
   chunks/actions_counts.js (tab counts, All first) is now renderPage's
   `counts` and the tab order below, and chunks/table_sort.js isn't needed.

   The data is p()'s actions_data push from content-scripts/inner.js:
   {processes, imports, exports, actions, files}, each [{label, entityLongId}],
   imports also {importDefinition: {source}}. CSV files and columns are the
   compiled view's, so Summary's Download all writes the same files. */

var LISTS = [['processes', 'Processes', 'Process'], ['imports', 'Imports', 'Import'],
             ['exports', 'Exports', 'Export'], ['actions', 'Actions', 'Action'], ['files', 'Files', 'File']];

function bare(id) { return id == null ? '' : String(id).replaceAll('_', ''); }
function sourceOf(x) { return x.importDefinition && x.importDefinition.source; }

// The ID in mono with a copy button that shows on row hover (rows carry `group`).
function copyId(id, label) {
  var text = bare(id), wrap = el('div', 'ia-id');
  if (!text) return wrap;
  wrap.appendChild(el('span', 'text-sm text-muted-foreground font-mono', text));
  var b = el('button', 'ia-copy');
  b.type = 'button';
  b.title = 'Copy ' + (label || 'ID');
  b.setAttribute('aria-label', b.title);
  b.appendChild(icon('copy', null, 14));
  b.addEventListener('click', function () {
    navigator.clipboard.writeText(text);
    b.replaceChildren(icon('check', 'ia-copied', 14));
    b.classList.add('ia-done');
    setTimeout(function () { b.replaceChildren(icon('copy', null, 14)); b.classList.remove('ia-done'); }, 1200);
  });
  wrap.appendChild(b);
  return wrap;
}

function nameCell(t) { return el('p', 'text-sm text-foreground ia-name', t); }
function nameOf(x) { return x.label || ''; }
function idOf(x) { return bare(x.entityLongId); }
function nameId(x) { return { Name: x.label, Id: x.entityLongId }; }

function list(key) {
  return function (d) { return (d && Array.isArray(d[key]) && d[key]) || []; };
}

function tab(key, label) {
  var imports = key === 'imports';
  return {
    label: label,
    heading: label,
    placeholder: 'Search ' + label.toLowerCase() + ' by name or ID...',
    rows: list(key),
    cols: imports ? 'ia-acts-3' : 'ia-acts-2',
    headers: [{ label: 'Name', sort: nameOf }, { label: 'Identifier', sort: idOf }]
      .concat(imports ? [{ label: 'Source Identifier', sort: function (x) { return bare(sourceOf(x)); } }] : []),
    key: function (x) { return nameOf(x) + ' ' + idOf(x) + (imports ? ' ' + bare(sourceOf(x)) : ''); },
    cells: function (x) {
      return [nameCell(x.label), copyId(x.entityLongId)]
        .concat(imports ? [copyId(sourceOf(x), 'source ID')] : []);
    },
    csvRow: imports ? function (x) {
      var s = sourceOf(x);
      return { Name: x.label, Id: x.entityLongId, SourceID: s == null ? '' : bare(s) };
    } : nameId,
    filename: key + '.csv'
  };
}

/* All: every list in one table, Type first. An import's source ID sits under
   its own ID, as a fourth column would not fit a side panel. */
var ALL = {
  label: 'All',
  heading: 'All',
  placeholder: 'Search by name or ID...',
  rows: function (d) {
    var out = [];
    LISTS.forEach(function (l) { list(l[0])(d).forEach(function (x) { out.push({ kind: l[2], x: x }); }); });
    return out;
  },
  cols: 'ia-acts-all',
  headers: [{ label: 'Type', sort: function (r) { return r.kind; } },
            { label: 'Name', sort: function (r) { return nameOf(r.x); } },
            { label: 'Identifier', sort: function (r) { return idOf(r.x); } }],
  key: function (r) { return r.kind + ' ' + nameOf(r.x) + ' ' + idOf(r.x) + ' ' + bare(sourceOf(r.x)); },
  cells: function (r) {
    var ids = el('div', 'min-w-0');
    ids.appendChild(copyId(r.x.entityLongId));
    if (sourceOf(r.x) != null) {
      var src = copyId(sourceOf(r.x), 'source ID');
      src.insertBefore(el('span', 'text-xs text-muted-foreground', 'from'), src.firstChild);
      ids.appendChild(src);
    }
    return [el('p', 'text-xs text-muted-foreground', r.kind), nameCell(r.x.label), ids];
  },
  csvRow: function (r) {
    var s = sourceOf(r.x);
    return { Type: r.kind, Name: r.x.label, Id: r.x.entityLongId, SourceID: s == null ? '' : bare(s) };
  },
  filename: 'all.csv',
  zip: false
};

renderPage({
  page: 'actions',
  placeholder: 'Search...',
  counts: true,
  tabs: [ALL].concat(LISTS.map(function (l) { return tab(l[0], l[1]); }))
});

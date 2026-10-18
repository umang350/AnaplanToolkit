/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell, linkCell } from './sv_shared.js';

/* Impact - for each line item, which line items' formulas use it ("Used by")
   and which it uses ("Depends on"), directly and all the way down, with the
   modules and App pages that reach. Gathered by IA_gimp in inner.js: the links
   come from the formulas (the scanner Delete Line Items orders its deletes
   with) and arrive as positions in `items`; the pages come from the /pages
   list. It reads formulas only - a line item that a saved view, import, export
   or process uses and no formula does shows as unused. */

var NAME_CAP = 200, walks = new WeakMap(), tables = new WeakMap();

/* The latest payload, for the cells and CSV (the links are positions in it, and
   renderPage hands them rows only). Every tab's rows come through here first. */
var currentData = null;

function items(d) {
  if (d && d.items && currentData !== d) d.items.forEach(function (it, i) { it.at = i; });
  currentData = d || null;
  if (!d || !d.items) return [];
  /* Most-used first (the model's own order is arbitrary and most line items are used by nothing),
     worked out once per payload. */
  return d.byUse || (d.byUse = d.items.slice().sort(function (a, b) { return b.usedBy.length - a.usedBy.length; }));
}

/* Everything reached from item `start` along `field` ('usedBy' down, 'uses'
   up), nearest first: [{i, depth}]. Worked out when a row is opened and kept,
   never for every row at once. */
function reach(d, start, field) {
  var memo = walks.get(d) || walks.set(d, {}).get(d), key = field + start;
  if (memo[key]) return memo[key];
  var list = d.items, seen = new Set([start]), out = [], layer = [start], depth = 0;
  while (layer.length) {
    depth++;
    var next = [];
    layer.forEach(function (i) {
      (list[i][field] || []).forEach(function (j) {
        if (!seen.has(j) && list[j]) { seen.add(j); out.push({ i: j, depth: depth }); next.push(j); }
      });
    });
    layer = next;
  }
  return (memo[key] = out);
}

function plural(n, one, many) { return n.toLocaleString() + ' ' + (n === 1 ? one : many || one + 's'); }

function pagesOf(d, moduleId) { return (d.pages && d.pages[moduleId]) || []; }

/* The opened list: a line saying how far it reaches, then every line item by
   distance (capped - the CSV has them all). */
function fill(box, d, row, field) {
  var start = row.at, hits = reach(d, start, field), mods = new Set(), pages = new Map();
  hits.forEach(function (h) {
    var it = d.items[h.i];
    mods.add(it.moduleId);
    if (field === 'usedBy') pagesOf(d, it.moduleId).forEach(function (p) { pages.set(p.url || p.name, p); });
  });
  if (field === 'usedBy') pagesOf(d, row.moduleId).forEach(function (p) { pages.set(p.url || p.name, p); });
  var sum = plural(hits.length, 'line item') + ' in ' + plural(mods.size, 'module');
  if (field === 'usedBy' && pages.size) sum += '; ' + plural(pages.size, 'App page') + ' on the modules reached';
  box.appendChild(el('p', 'text-xs text-muted-foreground', sum));
  if (field === 'usedBy' && pages.size) {
    var pl = el('div', 'ia-impact-pages');
    [...pages.values()].slice(0, 40).forEach(function (p) {
      pl.appendChild(linkCell((p.app ? p.app + ' › ' : '') + p.name, p.url));
    });
    if (pages.size > 40) pl.appendChild(el('p', 'text-xs text-muted-foreground', '+' + (pages.size - 40) + ' more pages (see the CSV or the Modules tab)'));
    box.appendChild(pl);
  }
  var ul = el('ul', 'ia-impact-list');
  hits.slice(0, NAME_CAP).forEach(function (h) {
    var it = d.items[h.i], li = el('li');
    li.appendChild(el('span', 'ia-impact-depth', h.depth === 1 ? 'direct' : 'level ' + h.depth));
    var t = el('span', 'ia-impact-name');
    t.appendChild(el('span', 'ia-impact-mod', it.module));
    t.appendChild(document.createTextNode(it.name));
    li.appendChild(t);
    ul.appendChild(li);
  });
  box.appendChild(ul);
  if (hits.length > NAME_CAP)
    box.appendChild(el('p', 'text-xs text-muted-foreground', '+' + (hits.length - NAME_CAP).toLocaleString() + ' more - Export to CSV lists the direct links of every line item.'));
}

function relCell(d, row, field, cls) {
  var direct = row[field].length, wrap = el('div', 'min-w-0 ' + cls);
  if (!direct) { wrap.appendChild(el('p', 'text-xs text-muted-foreground', '–')); return wrap; }
  var det = el('details', 'ia-impact'), total = reach(d, row.at, field).length;
  det.appendChild(el('summary', 'text-sm text-foreground', direct + ' direct · ' + total.toLocaleString() + ' in all'));
  var done = false;
  det.addEventListener('toggle', function () {
    if (!det.open || done) return;
    done = true;
    var body = el('div', 'ia-impact-body');
    fill(body, d, row, field);
    det.appendChild(body);
  });
  wrap.appendChild(det);
  return wrap;
}

/* One row per module: which modules its line items feed and are fed by. */
function moduleRows(d) {
  if (tables.has(d)) return tables.get(d);
  currentData = d;
  var by = new Map();
  (d.modules || []).forEach(function (m) { by.set(m.id, { id: m.id, name: m.name, lineItems: m.lineItems, feeds: new Map(), fedBy: new Map(), links: 0 }); });
  items(d).forEach(function (it) {
    var m = by.get(it.moduleId);
    if (!m) by.set(it.moduleId, m = { id: it.moduleId, name: it.module, lineItems: 0, feeds: new Map(), fedBy: new Map(), links: 0 });
    it.usedBy.forEach(function (j) {
      var u = d.items[j];
      if (!u || u.moduleId === it.moduleId) return;
      m.feeds.set(u.moduleId, u.module);
      m.links++;
      var o = by.get(u.moduleId);
      o && o.fedBy.set(it.moduleId, it.module);
    });
  });
  var rows = [...by.values()];
  tables.set(d, rows);
  return rows;
}

function namesCell(map, cls) {
  var names = [...map.values()].sort();
  if (!names.length) return textCell('–', cls + ' text-xs text-muted-foreground');
  return textCell(names.slice(0, 8).join(', ') + (names.length > 8 ? ' and ' + (names.length - 8) + ' more' : ''), cls + ' text-xs text-foreground');
}

function note(d) {
  var n = 'Read from the formulas only: a line item that a page, saved view, import, export or process uses and no formula does shows as not used.';
  return d && d.pagesError ? n + ' The App page list could not be read (' + d.pagesError + '), so pages are not shown.' : n;
}

renderPage({
  page: 'impact',
  placeholder: 'Search by module or line item...',
  tabs: [
    {
      label: 'Line Items',
      heading: 'Impact by Line Item',
      note: note,
      rows: items,
      max: 200,
      placeholder: 'Search by module or line item...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Module', cls: 'col-span-2', sort: function (r) { return r.module; } },
                { label: 'Line Item', cls: 'col-span-3', sort: function (r) { return r.name; } },
                { label: 'Used by', cls: 'ia-span-4', sort: function (r) { return r.usedBy.length; } },
                { label: 'Depends on', cls: 'col-span-3', sort: function (r) { return r.uses.length; } }],
      key: function (r) { return r.module + ' ' + r.name + ' ' + r.id; },
      cells: function (r) {
        var li = idCell(r.name, r.id), d = currentData;
        li.classList.add('col-span-3');
        return [textCell(r.module, 'col-span-2 text-sm text-foreground'), li,
                relCell(d, r, 'usedBy', 'ia-span-4'), relCell(d, r, 'uses', 'col-span-3')];
      },
      csv: function (rows) {
        var d = currentData, out = [];
        rows.forEach(function (r) {
          var base = { Module: r.module, LineItem: r.name, LineItemId: r.id, UsesCount: r.uses.length };
          if (!r.usedBy.length) { out.push(Object.assign({}, base, { UsedByModule: '', UsedByLineItem: '', UsedByLineItemId: '' })); return; }
          r.usedBy.forEach(function (j) {
            var u = d.items[j];
            out.push(Object.assign({}, base, { UsedByModule: u.module, UsedByLineItem: u.name, UsedByLineItemId: u.id }));
          });
        });
        return out;
      },
      filename: 'impact-line-items.csv'
    },
    {
      label: 'Modules',
      heading: 'Impact by Module',
      note: note,
      rows: moduleRows,
      max: 400,
      placeholder: 'Search by module...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Module', cls: 'col-span-3', sort: function (m) { return m.name; } },
                { label: 'Feeds modules', cls: 'col-span-3', sort: function (m) { return m.feeds.size; } },
                { label: 'Fed by modules', cls: 'col-span-3', sort: function (m) { return m.fedBy.size; } },
                { label: 'App pages', cls: 'col-span-3', sort: function (m) { return pagesOf(currentData, m.id).length; } }],
      key: function (m) { return m.name + ' ' + m.id + ' ' + [...m.feeds.values()].join(' ') + ' ' + [...m.fedBy.values()].join(' '); },
      cells: function (m) {
        var pg = pagesOf(currentData, m.id), pc = el('div', 'min-w-0 col-span-3');
        if (!pg.length) pc.appendChild(textCell('–', 'text-xs text-muted-foreground'));
        pg.slice(0, 5).forEach(function (p) { pc.appendChild(linkCell((p.app ? p.app + ' › ' : '') + p.name, p.url)); });
        if (pg.length > 5) pc.appendChild(textCell('+' + (pg.length - 5) + ' more', 'text-xs text-muted-foreground'));
        var nm = idCell(m.name, m.id);
        nm.classList.add('col-span-3');
        return [nm, namesCell(m.feeds, 'col-span-3'), namesCell(m.fedBy, 'col-span-3'), pc];
      },
      csvRow: function (m) {
        return {
          Module: m.name, ModuleId: m.id, LineItems: m.lineItems,
          FeedsModules: [...m.feeds.values()].sort().join('; '),
          FedByModules: [...m.fedBy.values()].sort().join('; '),
          Pages: pagesOf(currentData, m.id).map(function (p) { return p.app ? p.app + ' > ' + p.name : p.name; }).join('; ')
        };
      },
      filename: 'impact-modules.csv'
    }
  ]
});

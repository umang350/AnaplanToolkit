/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Shared shell for the hand-written report pages (Workspace, Filters, SV List, SV Items, SV Screens, SV Actions,
 * Process Steps, Modules, Line Items, Lists).
 *
 * The other five views are compiled Svelte (chunks/<page>-<hash>.js) and there
 * is no Svelte source in this repository - the chunks are committed build
 * output. So these two pages are plain ES modules instead.
 *
 * The CSV writer and the search scorer below are deliberate ports of the ones
 * inside chunks/Empty-CLVvVHxX.js, so all nine views export and search
 * identically. They are copied rather than imported because that chunk's
 * exports are minified single letters (`u`, `f`, `i`): if the bundle were ever
 * rebuilt elsewhere those names would very likely still resolve, but to
 * different functions - importing them would fail silently rather than loudly.
 *
 * The class strings are the ones the compiled views use, so the grid overrides
 * in views.css (which keep long Anaplan names inside the card) apply here too.
 */

var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

export var LOGO = `data:image/svg+xml,<svg%20xmlns='http://www.w3.org/2000/svg'%20height='30'%20viewBox='0%200%20189%2051'><rect%20x='0'%20y='3'%20width='45'%20height='45'%20rx='10'%20fill='%23E60012'/><text%20x='22.5'%20y='34'%20text-anchor='middle'%20font-family='Geist,-apple-system,BlinkMacSystemFont,Segoe%20UI,Roboto,Helvetica,Arial,sans-serif'%20font-size='21'%20font-weight='700'%20letter-spacing='-0.5'%20fill='%23ffffff'>AA</text><text%20x='57'%20y='24'%20font-family='Geist,-apple-system,BlinkMacSystemFont,Segoe%20UI,Roboto,Helvetica,Arial,sans-serif'%20font-size='20'%20font-weight='700'%20letter-spacing='-0.5'%20fill='%23202020'>Advanced</text><text%20x='57'%20y='44'%20font-family='Geist,-apple-system,BlinkMacSystemFont,Segoe%20UI,Roboto,Helvetica,Arial,sans-serif'%20font-size='15'%20font-weight='500'%20letter-spacing='-0.2'%20fill='%236b6b6b'>Anaplan%20Tool</text></svg>`;

/* ---------------------------------------------------------------------------
   CSV. Port of yt()/bt() in Empty-CLVvVHxX.js: UTF-8 BOM so Excel picks the
   encoding up, CRLF row endings, and a cell is quoted only when it has to be.
   --------------------------------------------------------------------------- */

function csvCell(v) {
  if (v == null) return '';
  var s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

// The file's text, BOM included - also what Summary's "Download all" zips up.
export function csvText(rows) {
  var cols = Object.keys(rows[0]);
  return '﻿' + [cols.map(csvCell).join(',')]
    .concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); }))
    .join('\r\n');
}

export function csv(rows, filename) {
  if (!rows || !rows.length) return;
  var url = window.URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8;' })),
      a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { window.URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
}

/* ---------------------------------------------------------------------------
   Search. Port of vt()/xt(): exact match scores 1, substring .9, otherwise a
   Levenshtein-derived score. Anything below .65 is dropped, best first.
   --------------------------------------------------------------------------- */

function score(query, target) {
  if (!query || !target) return 0;
  var q = query.toLowerCase(), t = target.toLowerCase();
  if (q === t) return 1;
  if (t.includes(q)) return .9;
  var n = q.length, m = t.length, row = [], best = n;
  for (var i = 0; i <= n; i++) row[i] = i;
  for (var j = 1; j <= m; j++) {
    var prev = row[0];
    row[0] = 0;
    for (var k = 1; k <= n; k++) {
      var was = row[k];
      row[k] = Math.min(row[k] + 1, row[k - 1] + 1, prev + (q[k - 1] === t[j - 1] ? 0 : 1));
      prev = was;
    }
    if (row[n] < best) best = row[n];
  }
  return Math.max(0, 1 - best / n);
}

export function search(list, query, key) {
  if (!query) return list;
  return list
    .map(function (item) { return { item: item, score: score(query, key(item)) }; })
    .filter(function (x) { return x.score >= .65; })
    .sort(function (a, b) { return b.score - a.score; })
    .map(function (x) { return x.item; });
}

/* --- DOM helpers ---------------------------------------------------------- */

var SVG_NS = 'http://www.w3.org/2000/svg';

// Lucide icon nodes, lifted from the compiled chunks so the icons match.
var ICONS = {
  download: [['path', { d: 'M12 15V3' }],
             ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
             ['path', { d: 'm7 10 5 5 5-5' }]],
  search: [['path', { d: 'm21 21-4.34-4.34' }],
           ['circle', { cx: '11', cy: '11', r: '8' }]],
  bug: [['path', { d: 'M12 20v-9' }],
        ['path', { d: 'M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z' }],
        ['path', { d: 'M14.12 3.88 16 2' }],
        ['path', { d: 'M21 21a4 4 0 0 0-3.81-4' }],
        ['path', { d: 'M21 5a4 4 0 0 1-3.55 3.97' }],
        ['path', { d: 'M22 13h-4' }],
        ['path', { d: 'M3 21a4 4 0 0 1 3.81-4' }],
        ['path', { d: 'M3 5a4 4 0 0 0 3.55 3.97' }],
        ['path', { d: 'M6 13H2' }],
        ['path', { d: 'm8 2 1.88 1.88' }],
        ['path', { d: 'M9 7.13V6a3 3 0 1 1 6 0v1.13' }]],
  'package-open': [['path', { d: 'M12 22v-9' }],
                   ['path', { d: 'M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z' }],
                   ['path', { d: 'M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13' }],
                   ['path', { d: 'M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z' }]],
  'external-link': [['path', { d: 'M15 3h6v6' }],
                    ['path', { d: 'M10 14 21 3' }],
                    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]]
};

export function icon(name, cls, size, strokeWidth) {
  var svg = document.createElementNS(SVG_NS, 'svg'), n = size || 24;
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', n);
  svg.setAttribute('height', n);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', strokeWidth == null ? 2 : strokeWidth);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'lucide-icon lucide lucide-' + name + (cls ? ' ' + cls : ''));
  (ICONS[name] || []).forEach(function (node) {
    var child = document.createElementNS(SVG_NS, node[0]);
    for (var k in node[1]) child.setAttribute(k, node[1][k]);
    svg.appendChild(child);
  });
  return svg;
}

export function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* A cell holding a page name that links out to the App page, matching how the
   Filters and Usages views present theirs. */
export function linkCell(text, href) {
  var p = el('p', 'text-sm text-foreground');
  if (!href) { p.textContent = text; return p; }
  var a = el('a', 'inline-flex items-start gap-1 hover:underline', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  // Explicit 12px: the compiled CSS has no size-3, so the class alone left it at 24px.
  a.appendChild(icon('external-link', 'size-3 shrink-0 mt-0.5 stroke-muted-foreground', 12));
  p.appendChild(a);
  return p;
}

export function textCell(text, cls) {
  return el('p', cls || 'text-sm text-foreground', text);
}

/* Name on top, mono identifier beneath - the Actions view's treatment of IDs. */
export function idCell(name, id) {
  var wrap = el('div', 'min-w-0');
  wrap.appendChild(el('p', 'text-sm text-foreground', name));
  if (id) wrap.appendChild(el('p', 'text-xs text-muted-foreground font-mono leading-none pt-0.5', id));
  return wrap;
}

/* --- full-page states ----------------------------------------------------- */

function centred(gap) {
  return el('div', 'h-screen flex flex-col justify-center items-center gap-' + gap);
}

function errorState(message) {
  var root = centred(4),
      top = el('div', 'flex items-center justify-center'),
      body = el('div', 'flex flex-col justify-center max-w-4xl items-center gap-2 text-center');
  top.appendChild(icon('bug', 'stroke-red-600', 48, 2));
  body.appendChild(el('h2', 'text-lg font-semibold text-foreground', "That's an error!"));
  body.appendChild(el('p', 'text-xs text-muted-foreground', message || ''));
  root.appendChild(top);
  root.appendChild(body);
  return root;
}

function loadingState() {
  var root = centred(10);
  root.innerHTML =
    '<div class="relative h-32 w-32">' +
      '<div class="absolute inset-0 animate-[spin_5s_linear_infinite]"><svg viewBox="0 0 128 128" class="h-full w-full">' +
        '<circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="20 10" class="text-foreground/20"></circle></svg></div>' +
      '<div class="absolute inset-2 animate-[spin_4s_linear_infinite_reverse]"><svg viewBox="0 0 128 128" class="h-full w-full">' +
        '<circle cx="64" cy="64" r="48" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="8 16" class="text-foreground/30"></circle></svg></div>' +
      '<div class="absolute inset-0 flex items-center justify-center"></div>' +
    '</div>' +
    '<div class="flex flex-col items-center gap-2 text-center max-w-2xl">' +
      '<h2 class="text-lg font-semibold text-foreground">Model Analysis</h2>' +
      '<p class="text-xs text-muted-foreground">Gathering data, your result will appear here shortly. Loading times can vary widely and depend on the size of your Model, the number of Apps and Pages, and your Internet Connection.</p>' +
    '</div>';
  root.querySelector('.absolute.inset-0.flex').appendChild(icon('package-open', null, 48, 1));
  var img = el('img');
  img.alt = 'Anaplan Toolkit';
  img.src = LOGO;
  root.appendChild(img);
  return root;
}

function nothingState() {
  var root = centred(4),
      body = el('div', 'flex flex-col justify-center max-w-4xl items-center gap-4 text-center');
  body.appendChild(icon('package-open', 'size-12 stroke-1 stroke-foreground/90'));
  body.appendChild(el('p', 'text-xs text-muted-foreground', "There's nothing here."));
  root.appendChild(body);
  return root;
}

function noMatchState() {
  var root = el('div', 'flex flex-col justify-center items-center gap-4 py-16'),
      body = el('div', 'flex flex-col justify-center max-w-4xl items-center gap-4 text-center');
  body.appendChild(icon('package-open', 'size-12 stroke-1 stroke-foreground/90'));
  body.appendChild(el('p', 'text-xs text-muted-foreground', 'No results match your search.'));
  root.appendChild(body);
  return root;
}

/* ---------------------------------------------------------------------------
   The page itself.

   opts = {
     page        message-type prefix, e.g. 'sv_screens' -> listens for sv_screens_data
     heading     <h1> text
     note        optional muted line under the heading, for scope caveats - a
                 string, or data -> string when it depends on the data
     placeholder search box placeholder
     cols        grid template class shared by the header row and the data rows
     headers     [{label, cls, sort}] - clicking a header sorts by that column
                 (ascending, descending, then back to the original order).
                 `sort` is row -> the value to sort on; without it the column
                 sorts on its cell's text, which suits text but not, say, "1.2 GB".
     key         row -> the string the search box matches against
     cells       row -> [Node] , one per column
     csvRow      row -> a flat object; its keys become the CSV header
     csv         optional rows -> [flat object], for when one row exports as several
     filename    CSV file name
     top         optional data -> Node, shown under the heading, above the note and
                 table (Workspace's storage meter); not searched or exported
     rows        optional data -> [row], when the data is not the row array itself
     max         optional row cap: only this many rows are drawn, with a button to
                 draw more - for reports that run to tens of thousands of rows.
                 Search and Export to CSV still cover every row.
     tabs        optional [{label, rows: data -> [row], heading, note, top, placeholder,
                 cols, headers, key, cells, csvRow | csv, filename, max}] - one table
                 per tab, under a tab bar, with a row count beside the heading.
                 Without it the page is a single table over the data array,
                 described by the fields above.
   }
   --------------------------------------------------------------------------- */
export function renderPage(opts) {
  /* Summary's "Download all" (chunks/export_all.js) imports the view modules to
     reuse their CSV definitions: with IA_COLLECT set, a view hands its options
     over instead of drawing itself, so each report's columns live in one place. */
  if (globalThis.IA_COLLECT) { globalThis.IA_COLLECT[opts.page] = opts; return; }
  var mount = document.getElementById('app'),
      data = null, error = '', query = '', scrolled = false,
      tabs = opts.tabs || [opts], active = 0, shown = 0;

  try {
    api.runtime.onMessage.addListener(function (msg) {
      if (!msg || !msg.type) return;
      if (msg.type === opts.page + '_data') { data = msg.data || []; error = ''; shown = 0; render(); }
      if (msg.type === 'error') { error = msg.message; render(); }
    });
  } catch (e) { /* not in an extension page; the states below still render */ }

  window.addEventListener('scroll', function () {
    var now = window.scrollY >= 40;
    if (now !== scrolled) { scrolled = now; syncShadow(); }
  });

  var stickyEl = null;
  function syncShadow() {
    if (stickyEl) stickyEl.className =
      'z-10 sticky top-0 flex flex-col gap-4 p-4 bg-background' + (scrolled ? ' shadow-md' : '');
  }

  function tabRows(t) {
    var rows = t.rows ? t.rows(data) : data;
    return Array.isArray(rows) ? rows : [];
  }

  /* Column sort, per tab: {col, dir} with dir 1 / -1. Applied after search,
     so it orders the matches (search alone orders them by score), and Export
     to CSV writes them in the same order. Numbers sort as numbers, text
     naturally ("Item 2" before "Item 10"), blanks last either way. */
  var sorts = {}, textOf = {},
      collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function sortValue(t, i, row) {
    var h = t.headers[i];
    if (h.sort) return h.sort(row);
    var k = active + ':' + i, m = textOf[k] || (textOf[k] = new WeakMap());
    if (!m.has(row)) { var c = t.cells(row)[i]; m.set(row, c ? c.textContent.trim() : ''); }
    return m.get(row);
  }

  function blank(v) { return v == null || v === '' || v === '–' || (typeof v === 'number' && isNaN(v)); }

  function sorted(t, rows) {
    var st = sorts[active];
    if (!st) return rows;
    var keyed = rows.map(function (r) { return [sortValue(t, st.col, r), r]; });
    keyed.sort(function (a, b) {
      var x = a[0], y = b[0];
      if (blank(x) || blank(y)) return blank(x) - blank(y);
      var c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return c * st.dir;
    });
    return keyed.map(function (k) { return k[1]; });
  }

  function matches() {
    var t = tabs[active];
    return sorted(t, search(tabRows(t), query, t.key));
  }

  function buildTable(rows) {
    var t = tabs[active],
        lim = t.max ? Math.max(shown, t.max) : rows.length,
        card = el('div', 'rounded-md border border-border'),
        head = el('div', 'grid ' + t.cols + ' border-b border-border px-2 py-3');
    var st = sorts[active];
    t.headers.forEach(function (h, i) {
      var on = st && st.col === i,
          h3 = el('h3', (h.cls ? h.cls + ' ' : '') + 'font-semibold text-sm text-foreground ia-sortable', h.label);
      h3.setAttribute('role', 'button');
      h3.tabIndex = 0;
      h3.title = 'Sort by ' + h.label;
      h3.setAttribute('aria-sort', on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none');
      h3.appendChild(el('span', 'ia-sort-mark', on ? (st.dir > 0 ? ' ▲' : ' ▼') : ''));
      var go = function () {
        var cur = sorts[active];
        sorts[active] = !cur || cur.col !== i ? { col: i, dir: 1 } : cur.dir > 0 ? { col: i, dir: -1 } : null;
        shown = 0;
        var fresh = matches();
        card.parentNode && (card.closest('.ia-table') || card).replaceWith(buildTable(fresh));
      };
      h3.addEventListener('click', go);
      h3.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      head.appendChild(h3);
    });
    card.appendChild(head);

    var frag = document.createDocumentFragment();
    rows.slice(0, lim).forEach(function (row) {
      var line = el('div', 'grid items-center ' + t.cols +
        ' px-2 py-1 hover:bg-muted border-border not-last:border-b group');
      t.cells(row).forEach(function (c) { line.appendChild(c); });
      frag.appendChild(line);
    });
    card.appendChild(frag);
    if (rows.length <= lim) return card;

    var box = el('div', 'ia-table'), rest = rows.length - lim,
        more = el('button', 'ia-more', 'Show ' + Math.min(t.max, rest).toLocaleString() + ' more · ' +
                  rest.toLocaleString() + ' not shown');
    more.type = 'button';
    more.addEventListener('click', function () {
      shown = lim + t.max;
      box.replaceWith(buildTable(rows));
    });
    box.appendChild(card);
    box.appendChild(more);
    return box;
  }

  function render() {
    mount.replaceChildren();
    stickyEl = null;

    if (error) { mount.appendChild(errorState(error)); return; }
    if (data === null) { mount.appendChild(loadingState()); return; }
    if (!tabs.some(function (t) { return tabRows(t).length; })) { mount.appendChild(nothingState()); return; }

    var tab = tabs[active],
        rows = matches(),
        root = el('div', 'size-full'),
        sticky = el('div');

    stickyEl = sticky;
    syncShadow();

    // Tab bar - the compiled views' tabs-list / tabs-trigger classes.
    if (opts.tabs) {
      var list = el('div', 'bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]');
      list.setAttribute('role', 'tablist');
      list.setAttribute('data-slot', 'tabs-list');
      tabs.forEach(function (t, i) {
        var b = el('button',
          'data-[state=active]:bg-background! text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center ' +
          'justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap ' +
          'transition-[color,box-shadow] data-[state=active]:shadow-sm hover:cursor-pointer', t.label);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('data-slot', 'tabs-trigger');
        b.setAttribute('data-state', i === active ? 'active' : 'inactive');
        b.setAttribute('aria-selected', i === active ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (i === active) return;
          active = i;
          shown = 0;
          render();
        });
        list.appendChild(b);
      });
      var tabWrap = el('div');
      tabWrap.appendChild(list);
      sticky.appendChild(tabWrap);
    }

    // Logo + export
    var bar = el('div', 'w-full flex justify-between items-center'),
        img = el('img', 'h-6');
    img.alt = 'Anaplan Toolkit';
    img.src = LOGO;
    bar.appendChild(img);

    var exportBtn = el('button',
      "aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center " +
      "justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all " +
      "focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 " +
      "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 hover:cursor-pointer " +
      "bg-background shadow-xs hover:bg-accent hover:text-accent-foreground border " +
      "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5");
    exportBtn.type = 'button';
    exportBtn.setAttribute('data-slot', 'button');
    exportBtn.appendChild(icon('download'));
    exportBtn.appendChild(document.createTextNode('Export to CSV'));
    exportBtn.addEventListener('click', function () {
      var hit = matches();
      csv(tab.csv ? tab.csv(hit) : hit.map(tab.csvRow), tab.filename);
    });
    bar.appendChild(exportBtn);
    sticky.appendChild(bar);

    // Declared up front: the search handler below writes to all three.
    var count = el('span'), body = el('div'),
        chip = opts.tabs ? el('span', 'text-sm bg-secondary rounded-md p-1 px-2 font-medium', rows.length) : null;

    // Search
    var searchWrap = el('div'),
        group = el('div',
          'group/input-group border-input relative flex w-full items-center rounded-md border shadow-xs ' +
          'transition-[color,box-shadow] outline-none ' +
          'has-[[data-slot=input-group-control]:focus-visible]:border-ring ' +
          'has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 ' +
          'has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] bg-background! h-8');
    group.setAttribute('role', 'group');
    group.setAttribute('data-slot', 'input-group');

    var addonBase = 'text-muted-foreground flex h-auto cursor-text items-center justify-center gap-2 py-1.5 ' +
                    "text-sm font-medium select-none [&>svg:not([class*='size-'])]:size-4";

    var lead = el('span', addonBase + ' order-first ps-3');
    lead.setAttribute('data-slot', 'input-group-addon');
    lead.setAttribute('data-align', 'inline-start');
    lead.appendChild(icon('search'));
    group.appendChild(lead);

    var input = el('input',
      'flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 outline-none ps-2 pe-2 text-xs');
    input.setAttribute('data-slot', 'input-group-control');
    input.type = 'text';
    input.placeholder = tab.placeholder || opts.placeholder;
    input.value = query;
    input.addEventListener('input', function () {
      query = input.value;
      shown = 0;
      // Redraw in place so the caret and focus survive the keystroke.
      var fresh = matches();
      count.textContent = fresh.length + ' results';
      count.hidden = !query;
      if (chip) chip.textContent = fresh.length;
      body.replaceChildren(fresh.length ? buildTable(fresh) : noMatchState());
    });
    group.appendChild(input);

    count.className = addonBase + ' pe-3 text-xs';
    count.textContent = rows.length + ' results';
    count.setAttribute('data-slot', 'input-group-addon');
    count.setAttribute('data-align', 'inline-end');
    count.hidden = !query;
    group.appendChild(count);

    searchWrap.appendChild(group);
    sticky.appendChild(searchWrap);
    root.appendChild(sticky);

    // Content
    var content = el('div', 'space-y-6 p-4'),
        section = el('div', 'space-y-2');
    var title = el('div', 'flex items-center space-x-2');
    title.appendChild(el('h1', 'text-lg font-semibold', tab.heading));
    if (chip) title.appendChild(chip);
    section.appendChild(title);
    if (tab.top) { var top = tab.top(data); if (top) section.appendChild(top); }
    var note = typeof tab.note === 'function' ? tab.note(data) : tab.note;
    if (note) section.appendChild(el('p', 'text-xs text-muted-foreground', note));

    body.appendChild(rows.length ? buildTable(rows) : noMatchState());
    section.appendChild(body);
    content.appendChild(section);
    root.appendChild(content);

    mount.appendChild(root);
  }

  render();
}

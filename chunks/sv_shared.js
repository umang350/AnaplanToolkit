/*
 * Advanced Anaplan Tool
 * Author: Umang Chauhan
 */
/*
 * Shared shell for the hand-written report pages (SV Screens, SV Actions).
 *
 * The other five views are compiled Svelte (chunks/<page>-<hash>.js) and there
 * is no Svelte source in this repository - the chunks are committed build
 * output. So these two pages are plain ES modules instead.
 *
 * The CSV writer and the search scorer below are deliberate ports of the ones
 * inside chunks/Empty-CLVvVHxX.js, so all seven views export and search
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

export function csv(rows, filename) {
  if (!rows || !rows.length) return;
  var cols = Object.keys(rows[0]),
      body = [cols.map(csvCell).join(',')]
        .concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); }))
        .join('\r\n'),
      url = window.URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' })),
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
  a.appendChild(icon('external-link', 'size-3 shrink-0 mt-0.5 stroke-muted-foreground'));
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
  img.alt = 'Advanced Anaplan Tool';
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
     note        optional muted line under the heading, for scope caveats
     placeholder search box placeholder
     cols        grid template class shared by the header row and the data rows
     headers     [{label, cls}]
     key         row -> the string the search box matches against
     cells       row -> [Node] , one per column
     csvRow      row -> a flat object; its keys become the CSV header
     filename    CSV file name
   }
   --------------------------------------------------------------------------- */
export function renderPage(opts) {
  var mount = document.getElementById('app'),
      data = null, error = '', query = '', scrolled = false;

  try {
    api.runtime.onMessage.addListener(function (msg) {
      if (!msg || !msg.type) return;
      if (msg.type === opts.page + '_data') { data = msg.data || []; error = ''; render(); }
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

  function matches() {
    return search(data || [], query, opts.key);
  }

  function buildTable(rows) {
    var card = el('div', 'rounded-md border border-border'),
        head = el('div', 'grid ' + opts.cols + ' border-b border-border px-2 py-3');
    opts.headers.forEach(function (h) {
      head.appendChild(el('h3', (h.cls ? h.cls + ' ' : '') + 'font-semibold text-sm text-foreground', h.label));
    });
    card.appendChild(head);

    var frag = document.createDocumentFragment();
    rows.forEach(function (row) {
      var line = el('div', 'grid items-center ' + opts.cols +
        ' px-2 py-1 hover:bg-muted border-border not-last:border-b group');
      opts.cells(row).forEach(function (c) { line.appendChild(c); });
      frag.appendChild(line);
    });
    card.appendChild(frag);
    return card;
  }

  function render() {
    mount.replaceChildren();
    stickyEl = null;

    if (error) { mount.appendChild(errorState(error)); return; }
    if (data === null) { mount.appendChild(loadingState()); return; }
    if (data.length === 0) { mount.appendChild(nothingState()); return; }

    var rows = matches(),
        root = el('div', 'size-full'),
        sticky = el('div');

    stickyEl = sticky;
    syncShadow();

    // Logo + export
    var bar = el('div', 'w-full flex justify-between items-center'),
        img = el('img', 'h-6');
    img.alt = 'Advanced Anaplan Tool';
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
      csv(matches().map(opts.csvRow), opts.filename);
    });
    bar.appendChild(exportBtn);
    sticky.appendChild(bar);

    // Declared up front: the search handler below writes to both.
    var count = el('span'), body = el('div');

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
    input.placeholder = opts.placeholder;
    input.value = query;
    input.addEventListener('input', function () {
      query = input.value;
      // Redraw in place so the caret and focus survive the keystroke.
      var fresh = matches();
      count.textContent = fresh.length + ' results';
      count.hidden = !query;
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
    section.appendChild(el('h1', 'text-lg font-semibold', opts.heading));
    if (opts.note) section.appendChild(el('p', 'text-xs text-muted-foreground', opts.note));

    body.appendChild(rows.length ? buildTable(rows) : noMatchState());
    section.appendChild(body);
    content.appendChild(section);
    root.appendChild(content);

    mount.appendChild(root);
  }

  render();
}

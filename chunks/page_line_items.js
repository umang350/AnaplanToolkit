/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, linkCell, textCell } from './sv_shared.js';
import { stackCell } from './structure_shared.js';

/* Line Items on Pages - every line item the widgets on the chosen App pages
   show, and where. Gathered by IA_gpli() in content-scripts/inner.js for the
   pages ticked in the panel's picker, as {rows, pages, sv, svError,
   savedViews, paths}:

     rows[]    one per widget x line item x placement: appName, category,
               pageName, pageUrl, widgetTitle, widgetType, source (module or
               saved view), lineItem, module, where
     pages[]   one per page scanned: widgets, lineItems (distinct), error
     paths[]   {path, count} - the widget-definition key paths line items were
               found under, which is what decides `where`

   `where` is Columns, Rows, Page selector, Chart or Shown (a placement the
   key path doesn't name) for line items a widget displays; Filter,
   Formatting, Sort or Hidden for ones it only uses; "All (module default)"
   when a widget names its module but no line item, so shows them all; and
   the saved view cases. Widget definitions are not documented, so `where`
   is read off key names - `paths` shows what it was read from. */

var USED = { Filter: 1, Formatting: 1, Sort: 1, Hidden: 1 };

function rowsOf(d) { return (d && d.rows) || []; }

function shown(r) { return r.lineItem && !USED[r.where]; }

function chooseButton() {
  var b = el('button', 'ia-dl-btn', 'Choose other pages');
  b.type = 'button';
  b.title = 'Back to the page picker - this report stays until the next one is gathered';
  b.addEventListener('click', function () {
    window.parent.postMessage({ type: 'ia_pli_pick' }, location.origin);
  });
  return b;
}

// Every tab: back to the picker, and what was scanned. `paths` adds the
// key paths disclosure (By Page only).
function top(d, paths) {
  var box = el('div', 'space-y-2'), bar = el('div', 'ia-dl'), pg = (d && d.pages) || [],
      bad = pg.filter(function (p) { return p.error; }).length;
  bar.appendChild(chooseButton());
  bar.appendChild(el('span', 'text-xs text-muted-foreground',
    pg.length + (pg.length === 1 ? ' page' : ' pages') + ' scanned' +
    (bad ? ' · ' + bad + ' could not be read (see Pages)' : '') +
    (d && d.savedViews ? ' · ' + d.savedViews + ' saved view' + (d.savedViews === 1 ? '' : 's') +
      (d.sv ? (d.svError ? ' not read' : ' read') : ' not read (option off)') : '')));
  box.appendChild(bar);
  if (d && d.svError) box.appendChild(el('p', 'text-xs text-muted-foreground', 'Saved views: ' + d.svError));
  if (paths && d && d.paths && d.paths.length) {
    var det = el('details', 'ia-fields-seen');
    det.appendChild(el('summary', null, 'Show where in the widget definitions line items were found'));
    d.paths.forEach(function (p) { det.appendChild(el('p', null, p.path + ' × ' + p.count)); });
    box.appendChild(det);
  }
  return box;
}

var NOTE = 'Placement is read from how Anaplan stores each widget: Columns, Rows and Page selector where it says so, ' +
  '"Shown" where it doesn\'t. "All (module default)" means the widget picks no line items, so shows its module\'s.';

function widgetCell(r) {
  return stackCell([r.widgetTitle || 'Unnamed', [r.widgetType, r.source].filter(Boolean).join(' · ')], 'col-span-2');
}

var BY_PAGE = {
  label: 'By Page',
  heading: 'Line Items on Pages',
  note: NOTE,
  top: function (d) { return top(d, true); },
  placeholder: 'Search by app, page, widget, line item or module...',
  rows: rowsOf,
  max: 2000,
  cols: 'grid-cols-12',
  headers: [{ label: 'App', cls: 'col-span-2' }, { label: 'Page', cls: 'col-span-2' },
            { label: 'Widget', cls: 'col-span-2' }, { label: 'Line Item', cls: 'col-span-2' },
            { label: 'Module', cls: 'col-span-2' }, { label: 'Where', cls: 'col-span-2' }],
  key: function (r) {
    return [r.appName, r.category, r.pageName, r.widgetTitle, r.source, r.lineItem, r.module, r.where].join(' ');
  },
  cells: function (r) {
    var app = stackCell([r.appName, r.category], 'col-span-2'), page = linkCell(r.pageName, r.pageUrl);
    page.classList.add('col-span-2');
    return [app, page, widgetCell(r),
      textCell(r.lineItem || '–', 'col-span-2 text-sm text-muted-foreground font-mono leading-none'),
      textCell(r.module || '–', 'col-span-2 text-sm text-foreground'),
      textCell(r.where, 'col-span-2 text-sm ' + (USED[r.where] ? 'text-muted-foreground' : 'text-foreground'))];
  },
  csvRow: function (r) {
    return {
      App: r.appName,
      Category: r.category || '',
      Page: r.pageName,
      'Page URL': r.pageUrl,
      Widget: r.widgetTitle || 'Unnamed',
      'Widget Type': r.widgetType || '',
      Source: r.source || '',
      'Line Item': r.lineItem || '',
      Module: r.module || '',
      Where: r.where
    };
  },
  filename: 'page_line_items.csv'
};

/* One row per line item: every page it is on, and how it is used there. */
function byItem(d) {
  var m = new Map();
  rowsOf(d).forEach(function (r) {
    if (!r.lineItem) return;
    var k = r.module + '\u0000' + r.lineItem, x = m.get(k);
    if (!x) m.set(k, x = { lineItem: r.lineItem, module: r.module, pages: new Map(), where: new Set(), shown: false });
    x.pages.set(r.pageUrl, r.pageName);
    x.where.add(r.where);
    if (shown(r)) x.shown = true;
  });
  return Array.from(m.values()).map(function (x) {
    return { lineItem: x.lineItem, module: x.module, shown: x.shown, where: Array.from(x.where),
             pages: Array.from(x.pages, function (p) { return { url: p[0], name: p[1] }; }) };
  });
}

function pagesCell(x) {
  var wrap = el('div', 'ia-span-4 min-w-0 space-y-1');
  x.pages.forEach(function (p) { wrap.appendChild(linkCell(p.name, p.url)); });
  return wrap;
}

var BY_ITEM = {
  label: 'By Line Item',
  heading: 'Line Items and Their Pages',
  note: 'Each line item found on the scanned pages, with every page it is on. "Only used" means it filters, formats or sorts a widget without being shown.',
  top: function (d) { return top(d); },
  placeholder: 'Search by line item, module, page or placement...',
  rows: byItem,
  max: 2000,
  cols: 'grid-cols-12',
  headers: [{ label: 'Line Item', cls: 'col-span-3' }, { label: 'Module', cls: 'col-span-2' },
            { label: 'Pages', cls: 'ia-span-4', sort: function (x) { return x.pages.length; } },
            { label: 'Where', cls: 'col-span-3' }],
  key: function (x) {
    return x.lineItem + ' ' + x.module + ' ' + x.where.join(' ') + ' ' + x.pages.map(function (p) { return p.name; }).join(' ');
  },
  cells: function (x) {
    return [textCell(x.lineItem, 'col-span-3 text-sm text-muted-foreground font-mono leading-none'),
      textCell(x.module || '–', 'col-span-2 text-sm text-foreground'),
      pagesCell(x),
      stackCell([x.where.join(', '), x.shown ? '' : 'Only used'], 'col-span-3')];
  },
  csvRow: function (x) {
    return {
      'Line Item': x.lineItem,
      Module: x.module || '',
      'Page Count': x.pages.length,
      Pages: x.pages.map(function (p) { return p.name; }).join('; '),
      Where: x.where.join('; '),
      Shown: x.shown ? 'Yes' : 'No (only used)'
    };
  },
  filename: 'page_line_items_by_line_item.csv'
};

var PAGES = {
  label: 'Pages',
  heading: 'Pages Scanned',
  top: function (d) { return top(d); },
  placeholder: 'Search by app, category or page...',
  rows: function (d) { return (d && d.pages) || []; },
  cols: 'grid-cols-12',
  headers: [{ label: 'App', cls: 'col-span-3' }, { label: 'Category', cls: 'col-span-2' },
            { label: 'Page', cls: 'col-span-3' },
            { label: 'Widgets', cls: 'ia-span-1', sort: function (p) { return p.widgets; } },
            { label: 'Line Items', cls: 'ia-span-1', sort: function (p) { return p.lineItems; } },
            { label: 'Status', cls: 'col-span-2' }],
  key: function (p) { return p.appName + ' ' + p.category + ' ' + p.pageName + ' ' + p.error; },
  cells: function (p) {
    var page = linkCell(p.pageName, p.pageUrl);
    page.classList.add('col-span-3');
    return [textCell(p.appName, 'col-span-3 text-sm text-foreground'),
      textCell(p.category || '–', 'col-span-2 text-sm text-muted-foreground'),
      page,
      textCell(String(p.widgets), 'ia-span-1 text-sm text-foreground'),
      textCell(String(p.lineItems), 'ia-span-1 text-sm text-foreground'),
      textCell(p.error ? 'Not read: ' + p.error : 'Read', 'col-span-2 text-sm ' + (p.error ? 'ia-error' : 'text-muted-foreground'))];
  },
  csvRow: function (p) {
    return { App: p.appName, Category: p.category || '', Page: p.pageName, 'Page URL': p.pageUrl,
             Widgets: p.widgets, 'Line Items': p.lineItems, Status: p.error ? 'Not read: ' + p.error : 'Read' };
  },
  filename: 'page_line_items_pages.csv'
};

renderPage({
  page: 'page_line_items',
  placeholder: 'Search...',
  tabs: [BY_PAGE, BY_ITEM, PAGES]
});

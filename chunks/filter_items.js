/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, linkCell, textCell } from './sv_shared.js';

/* Filters - Page Filters & Conditional Formatting.

   Replaces the compiled Svelte view (chunks/filter_items-RDu0uzD1.js.retired, kept in
   the repo but not shipped) so filters can show each line item beside its
   condition, and formatting rules can show their colours. The data comes from
   x()/S() in content-scripts/inner.js as {filterItems, conditionalFormattingItems}:

     filterItems[]                one per widget (or widget's saved view)
       conditions[]               {lineItem, condition, join} - join is "OR" on
                                  the later operands of an OR branch
       lineItems[]                names only; all that results cached before
                                  `conditions` existed carry
     conditionalFormattingItems[] one per rule
       pegs[]                     {value, color, icon} - each source value and
                                  the colour Anaplan paints at it
       onGrid                     false when the formatted line item is hidden
                                  from the grid: Anaplan keeps the rule, but it
                                  paints nothing. A string (the filter line
                                  items) when it is on the grid but a filter on
                                  its axis decides, per data and often per user,
                                  whether it shows. null when there is no grid
                                  to judge by, and on results cached before it */

function conditionsOf(r) {
  if (Array.isArray(r.conditions)) return r.conditions;
  return (r.lineItems || []).map(function (n) { return { lineItem: n, condition: '', join: '' }; });
}

function conditionText(c) {
  return (c.join ? c.join + ' ' : '') + (c.condition || '');
}

// Filter rows from a saved view have no condition here: it lives in the view.
function emptyCondition(r) {
  return r.savedViewName ? 'Set in the saved view' : '-';
}

function pegText(p) {
  var v = p.value == null ? '' : String(p.value);
  return v + (p.color ? ' → ' + p.color : '') + (p.icon ? ' → ' + p.icon : '');
}

/* Line item and condition sit in one cell spanning both columns, one pair per
   line, so each condition stays level with its own line item however either
   wraps. `narrow` spans four columns instead of six, for the All tab. */
function conditionsCell(r, narrow) {
  var wrap = el('div', 'ia-fpairs' + (narrow ? ' ia-fpairs-4' : ''));
  conditionsOf(r).forEach(function (c) {
    wrap.appendChild(el('p', 'text-sm text-muted-foreground font-mono leading-none', c.lineItem));
    var cond = el('p', 'text-sm text-foreground');
    if (c.join) cond.appendChild(el('span', 'ia-join', c.join));
    cond.appendChild(document.createTextNode(c.condition || emptyCondition(r)));
    if (!c.condition) cond.className = 'text-sm text-muted-foreground';
    wrap.appendChild(cond);
  });
  return wrap;
}

function pegsCell(r) {
  var wrap = el('div', 'ia-pegs');
  if (r.ruleType) wrap.appendChild(el('span', 'ia-rule', r.ruleType));
  (r.pegs || []).forEach(function (p) {
    var line = el('div', 'ia-peg');
    var sw = el('span', 'ia-swatch');
    if (p.color) sw.style.background = p.color;
    else sw.classList.add('ia-swatch-none');
    line.appendChild(sw);
    line.appendChild(el('span', 'ia-peg-v', p.value == null ? '' : String(p.value)));
    if (p.color) line.appendChild(el('span', 'ia-peg-c', p.color));
    if (p.icon) line.appendChild(el('span', 'ia-peg-c', p.icon));
    wrap.appendChild(line);
  });
  return wrap;
}

function filterRows(d) {
  if (Array.isArray(d)) return d;
  return (d && d.filterItems) || [];
}

function formattingRows(d) {
  return (d && !Array.isArray(d) && d.conditionalFormattingItems) || [];
}

var HIDDEN = 'Hidden on grid';

function hidden(r) { return r.onGrid === false; }

function filtered(r) { return typeof r.onGrid === 'string' ? 'Filtered: ' + r.onGrid : ''; }

function onGridText(r) { return r.onGrid == null ? '' : hidden(r) ? 'No' : filtered(r) || 'Yes'; }

function tagText(r) { return hidden(r) ? HIDDEN : filtered(r); }

function formattedCell(r, cls) {
  var p = el('div', cls);
  p.appendChild(document.createTextNode(r.formattedLineItem));
  if (hidden(r)) p.appendChild(el('span', 'ia-hidden', HIDDEN));
  else if (filtered(r)) p.appendChild(el('span', 'ia-hidden ia-filtered', filtered(r)));
  return p;
}

function base(r) {
  return [textCell(r.appName), linkCell(r.pageName, r.pageUrl), textCell(r.widgetTitle || 'Unnamed')];
}

var FILTERS = {
  label: 'Filters',
  heading: 'Filter Line Items',
  placeholder: 'Search by app, page, widget, line item or condition...',
  rows: filterRows,
  cols: 'grid-cols-12',
  headers: [{ label: 'App', cls: 'col-span-2' }, { label: 'Page', cls: 'col-span-2' },
            { label: 'Widget', cls: 'col-span-2' }, { label: 'Line Item', cls: 'col-span-3' },
            { label: 'Condition', cls: 'col-span-3' }],
  key: function (r) {
    return r.appName + ' ' + r.pageName + ' ' + r.widgetTitle + ' ' +
      conditionsOf(r).map(function (c) { return c.lineItem + ' ' + conditionText(c); }).join(' ');
  },
  cells: function (r) {
    var c = base(r);
    c[0].classList.add('col-span-2');
    c[1].classList.add('col-span-2');
    c[2].classList.add('col-span-2');
    return c.concat([conditionsCell(r)]);
  },
  // One CSV row per condition, so Line Item and Condition stay separate columns.
  csv: function (rows) {
    var out = [];
    rows.forEach(function (r) {
      conditionsOf(r).forEach(function (c) {
        out.push({
          App: r.appName,
          Page: r.pageName,
          'Page URL': r.pageUrl,
          Widget: r.widgetTitle || 'Unnamed',
          'Line Item': c.lineItem,
          Join: c.join || '',
          Condition: c.condition || (r.savedViewName ? 'Set in the saved view' : '')
        });
      });
    });
    return out;
  },
  filename: 'filter_line_items.csv'
};

var FORMATTING = {
  label: 'Conditional Formatting',
  heading: 'Conditional Formatting',
  placeholder: 'Search by app, page, widget, line item or colour...',
  rows: formattingRows,
  cols: 'grid-cols-12',
  headers: [{ label: 'App', cls: 'col-span-2' }, { label: 'Page', cls: 'col-span-2' },
            { label: 'Widget', cls: 'col-span-2' }, { label: 'Formatted Line Item', cls: 'col-span-2' },
            { label: 'Values From', cls: 'col-span-2' }, { label: 'Colours', cls: 'col-span-2' }],
  key: function (r) {
    return r.appName + ' ' + r.pageName + ' ' + r.widgetTitle + ' ' + r.formattedLineItem + ' ' +
      r.sourceLineItem + ' ' + r.ruleType + ' ' + (r.pegs || []).map(pegText).join(' ') +
      ' ' + tagText(r);
  },
  cells: function (r) {
    var c = base(r).concat([
      formattedCell(r, 'text-sm text-muted-foreground font-mono leading-none'),
      textCell(r.sourceLineItem, 'text-sm text-muted-foreground font-mono leading-none'),
      pegsCell(r)
    ]);
    c.forEach(function (n) { n.classList.add('col-span-2'); });
    return c;
  },
  csvRow: function (r) {
    return {
      App: r.appName,
      Page: r.pageName,
      'Page URL': r.pageUrl,
      Widget: r.widgetTitle || 'Unnamed',
      'Formatted Line Item': r.formattedLineItem,
      'On Grid': onGridText(r),
      'Values From': r.sourceLineItem,
      'Rule Type': r.ruleType,
      Colours: (r.pegs || []).map(pegText).join('; ')
    };
  },
  filename: 'conditional_formatting.csv'
};

/* All: both lists in one table. Rows are tagged so the cells and the CSV know
   which kind they hold; the search key reuses each tab's own. */
var ALL = {
  label: 'All',
  heading: 'All Line Item Dependencies',
  placeholder: 'Search...',
  rows: function (d) {
    return filterRows(d).map(function (r) { return { kind: 'Filter', r: r }; })
      .concat(formattingRows(d).map(function (r) { return { kind: 'Conditional Formatting', r: r }; }));
  },
  cols: 'grid-cols-12',
  headers: [{ label: 'Type', cls: 'col-span-2' }, { label: 'App', cls: 'col-span-2' },
            { label: 'Page', cls: 'col-span-2' }, { label: 'Widget', cls: 'col-span-2' },
            { label: 'Line Item(s)', cls: 'col-span-2' }, { label: 'Details', cls: 'col-span-2' }],
  key: function (x) { return x.kind + ' ' + (x.kind === 'Filter' ? FILTERS : FORMATTING).key(x.r); },
  cells: function (x) {
    var r = x.r, c = [textCell(x.kind)].concat(base(r));
    c.forEach(function (n) { n.classList.add('col-span-2'); });
    if (x.kind === 'Filter') return c.concat([conditionsCell(r, true)]);
    var items = el('div', 'col-span-2 space-y-1'), details = pegsCell(r);
    items.appendChild(formattedCell(r, 'text-sm text-muted-foreground font-mono leading-none'));
    items.appendChild(el('p', 'text-xs text-muted-foreground', 'values from ' + r.sourceLineItem));
    details.classList.add('col-span-2');
    return c.concat([items, details]);
  },
  csv: function (rows) {
    var out = [];
    rows.forEach(function (x) {
      var r = x.r, head = { Type: x.kind, App: r.appName, Page: r.pageName, 'Page URL': r.pageUrl,
                            Widget: r.widgetTitle || 'Unnamed' };
      if (x.kind === 'Filter') {
        conditionsOf(r).forEach(function (c) {
          out.push(Object.assign({}, head, {
            'Line Item': c.lineItem,
            'Values From': '',
            Details: conditionText(c) || (r.savedViewName ? 'Set in the saved view' : '')
          }));
        });
      } else {
        out.push(Object.assign({}, head, {
          'Line Item': r.formattedLineItem,
          'Values From': r.sourceLineItem,
          Details: [tagText(r), r.ruleType].concat((r.pegs || []).map(pegText)).filter(Boolean).join('; ')
        }));
      }
    });
    return out;
  },
  filename: 'page_line_item_dependencies.csv'
};

renderPage({
  page: 'filter_items',
  placeholder: 'Search...',
  tabs: [FILTERS, FORMATTING, ALL]
});

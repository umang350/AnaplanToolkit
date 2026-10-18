/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell, idCell } from './sv_shared.js';
import { formulaCell } from './structure_shared.js';

/* Formulas - search every formula in the model. Plain words (all must appear),
   "an exact phrase" or /a regular expression/, case-insensitive; the
   box matches the formula only, not the names, so /^IF/ means a formula that
   starts with IF. Gathered by IA_gfs in inner.js off the in-page model cache
   (no Anaplan calls). To find where a line item is used, the Impact view
   follows references properly; this is the free-text search. */

function rows(d) { return (d && d.formulas) || []; }

renderPage({
  page: 'formula_search',
  heading: 'Formulas',
  note: function (d) {
    return 'Search formula text: words, "an exact phrase" or /a regular expression/. ' +
      (d && d.total ? rows(d).length.toLocaleString() + ' of ' + d.total.toLocaleString() + ' line items have a formula.' : '');
  },
  literal: true,
  rows: rows,
  max: 300,
  placeholder: 'Search formulas: words, "phrase" or /regex/...',
  filename: 'formulas.csv',
  cols: 'grid-cols-12',
  headers: [{ label: 'Module', cls: 'col-span-2', sort: function (r) { return r.module; } },
            { label: 'Line Item', cls: 'col-span-2', sort: function (r) { return r.name; } },
            { label: 'Format', cls: 'col-span-2', sort: function (r) { return r.format; } },
            { label: 'Formula', cls: 'ia-span-6', sort: function (r) { return r.formula.length; } }],
  key: function (r) { return r.formula; },
  cells: function (r) {
    var li = idCell(r.name, r.id);
    li.classList.add('col-span-2');
    return [textCell(r.module, 'col-span-2 text-sm text-foreground'), li,
            textCell(r.format || '–', 'col-span-2 text-xs text-muted-foreground'),
            formulaCell(r.formula, 'ia-span-6')];
  },
  csvRow: function (r) {
    return { Module: r.module, ModuleId: r.moduleId, LineItem: r.name, LineItemId: r.id, Format: r.format, Formula: r.formula };
  }
});

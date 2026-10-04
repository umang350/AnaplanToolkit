/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell, idCell } from './sv_shared.js';
import { words, joined, formulaCell, stackCell, missingNote, fieldsBlock } from './structure_shared.js';

/* Line Items - every line item in every module, off the in-page model cache
   (IA_structure in content-scripts/main.js; no Anaplan calls). The search key
   carries the formula, so searching a line item's name also finds the
   formulas that reference it. A large model has tens of thousands of line
   items, hence the row cap (`max`) - search and CSV still cover all of them. */

function rows(d) {
  return (d && d.lineItems) || [];
}

function note(d) {
  var list = rows(d), keys = ((d && d.shape) || {}).lineItemInfo,
      fmt = list.some(function (r) { return r.format; }),
      fx = list.some(function (r) { return r.formula; });
  if (!list.length || (fmt && fx)) return '';
  return missingNote(!fmt && !fx ? 'line item formats and formulas' : !fmt ? 'line item formats' : 'formulas', keys);
}

// With formats or formulas missing, the fields Anaplan did hold.
function top(d) {
  return note(d) ? fieldsBlock(d && d.shape) : null;
}

renderPage({
  page: 'line_items',
  heading: 'Line Items',
  note: note,
  top: top,
  rows: rows,
  max: 400,
  placeholder: 'Search by module, line item, format or formula...',
  filename: 'line-items.csv',
  cols: 'grid-cols-12',
  // Explicit sort values: sorting on cell text would draw every row's cells first.
  headers: [{ label: 'Module', cls: 'col-span-2', sort: function (r) { return r.module; } },
            { label: 'Line Item', cls: 'col-span-2', sort: function (r) { return r.name; } },
            { label: 'Format', cls: 'col-span-2', sort: function (r) { return r.format; } },
            { label: 'Applies To', cls: 'col-span-2', sort: function (r) { return joined(r.appliesTo); } },
            { label: 'Formula', cls: 'ia-span-4', sort: function (r) { return r.formula; } }],
  key: function (r) {
    return r.module + ' ' + r.name + ' ' + r.id + ' ' + r.format + ' ' + joined(r.appliesTo) + ' ' + r.formula;
  },
  cells: function (r) {
    var li = idCell(r.name, r.id);
    li.classList.add('col-span-2');
    return [
      textCell(r.module, 'col-span-2 text-sm text-foreground'),
      li,
      stackCell([r.format || '–', r.time && 'Time: ' + words(r.time), r.summary && 'Summary: ' + words(r.summary)], 'col-span-2'),
      textCell(joined(r.appliesTo) || '–', 'col-span-2 text-xs text-muted-foreground'),
      formulaCell(r.formula, 'ia-span-4')
    ];
  },
  csvRow: function (r) {
    return {
      Module: r.module,
      ModuleId: r.moduleId,
      LineItem: r.name,
      LineItemId: r.id,
      Format: r.format,
      AppliesTo: (r.appliesTo || []).join('; '),
      Time: words(r.time),
      Summary: words(r.summary),
      Formula: r.formula,
      Notes: r.notes,
      Code: r.code
    };
  }
});

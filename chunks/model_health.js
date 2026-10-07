/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell, idCell, el } from './sv_shared.js';
import { formulaCell, joined } from './structure_shared.js';

/* Model Health - size and formula findings worked out from the in-page model
   cache (IA_health in content-scripts/inner.js; no Anaplan calls). Cells are
   estimated from the item counts of the lists a line item applies to; Time,
   Versions and subsets have no count there, so they are left out of the
   estimate and the row says so ("Partial"). The thresholds are rules of thumb
   for where to look first, not Anaplan limits. */

var nf = new Intl.NumberFormat();

function pick(name) {
  return function (d) { return (d && d[name]) || []; };
}

function cellsText(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : nf.format(n);
}

function note(text) {
  return function (d) {
    var t = (d && d.totals) || {};
    return text + (t.lineItems ? ' Read ' + nf.format(t.lineItems) + ' line items, ' + nf.format(t.withFormula) + ' with a formula.' : '');
  };
}

function partialTag(cell, r) {
  if (r.partial) cell.firstChild && cell.firstChild.appendChild(el('span', 'ia-tag', 'Partial'));
  return cell;
}

renderPage({
  page: 'model_health',
  placeholder: 'Search...',
  tabs: [
    {
      label: 'Large Line Items',
      heading: 'Large Line Items',
      note: note('Line items with the most cells (the product of the list sizes they apply to), over 50,000. Time and Versions are not counted.'),
      rows: pick('largeItems'),
      max: 400,
      placeholder: 'Search by module, line item or dimension...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Module', cls: 'col-span-3', sort: function (r) { return r.module; } },
                { label: 'Line Item', cls: 'col-span-3', sort: function (r) { return r.name; } },
                { label: 'Applies To', cls: 'col-span-4', sort: function (r) { return joined(r.dims); } },
                { label: 'Cells', cls: 'col-span-2', sort: function (r) { return r.cells; } }],
      key: function (r) { return r.module + ' ' + r.name + ' ' + r.id + ' ' + joined(r.dims); },
      cells: function (r) {
        var li = idCell(r.name, r.id);
        li.classList.add('col-span-3');
        return [textCell(r.module, 'col-span-3 text-sm text-foreground'), partialTag(li, r),
                textCell(joined(r.dims) || '–', 'col-span-4 text-xs text-muted-foreground'),
                textCell(cellsText(r.cells), 'col-span-2 text-sm text-foreground ia-num')];
      },
      csvRow: function (r) {
        return { Module: r.module, ModuleId: r.moduleId, LineItem: r.name, LineItemId: r.id, Format: r.format,
                 AppliesTo: (r.dims || []).join('; '), EstimatedCells: r.cells, Partial: !!r.partial };
      },
      filename: 'large-line-items.csv'
    },
    {
      label: 'Large Modules',
      heading: 'Large Modules',
      note: note('Modules by the estimated cells in all their line items, over 100,000. Time and Versions are not counted.'),
      rows: pick('largeModules'),
      max: 400,
      placeholder: 'Search by module or line item...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Module', cls: 'col-span-4', sort: function (r) { return r.module; } },
                { label: 'Largest Line Item', cls: 'col-span-3', sort: function (r) { return r.biggest; } },
                { label: 'Line Items', cls: 'col-span-2', sort: function (r) { return r.lineItems; } },
                { label: 'Cells', cls: 'col-span-3', sort: function (r) { return r.cells; } }],
      key: function (r) { return r.module + ' ' + r.moduleId + ' ' + r.biggest; },
      cells: function (r) {
        var m = idCell(r.module, r.moduleId);
        m.classList.add('col-span-4');
        return [partialTag(m, r), textCell(r.biggest || '–', 'col-span-3 text-sm text-foreground'),
                textCell(nf.format(r.lineItems), 'col-span-2 text-sm text-foreground ia-num'),
                textCell(cellsText(r.cells), 'col-span-3 text-sm text-foreground ia-num')];
      },
      csvRow: function (r) {
        return { Module: r.module, ModuleId: r.moduleId, LineItems: r.lineItems, LargestLineItem: r.biggest,
                 EstimatedCells: r.cells, Partial: !!r.partial };
      },
      filename: 'large-modules.csv'
    },
    {
      label: 'Duplicate Formulas',
      heading: 'Duplicate Formulas',
      note: note('Line items that share the same formula (spacing ignored, 25+ characters): candidates to calculate once and reference.'),
      rows: pick('duplicates'),
      max: 400,
      placeholder: 'Search by formula or line item...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Formula', cls: 'ia-span-5', sort: function (r) { return r.formula; } },
                { label: 'Line Items', cls: 'col-span-1', sort: function (r) { return r.count; } },
                { label: 'Modules', cls: 'col-span-1', sort: function (r) { return r.modules; } },
                { label: 'Where', cls: 'col-span-5', sort: function (r) { return r.members[0]; } }],
      key: function (r) { return r.formula + ' ' + r.members.join(' '); },
      cells: function (r) {
        return [formulaCell(r.formula, 'ia-span-5'),
                textCell(nf.format(r.count), 'col-span-1 text-sm text-foreground ia-num'),
                textCell(nf.format(r.modules), 'col-span-1 text-sm text-foreground ia-num'),
                textCell(r.members.join('; ') + (r.more ? '; +' + r.more + ' more' : ''), 'col-span-5 text-xs text-muted-foreground')];
      },
      csvRow: function (r) {
        return { Formula: r.formula, LineItems: r.count, Modules: r.modules,
                 Where: r.members.join('; ') + (r.more ? '; +' + r.more + ' more' : '') };
      },
      filename: 'duplicate-formulas.csv'
    },
    {
      label: 'Complex Formulas',
      heading: 'Complex Formulas',
      note: note('Formulas of 400+ characters, 5+ IFs or 6+ levels of brackets - the hardest to read and often to calculate.'),
      rows: pick('complex'),
      max: 400,
      placeholder: 'Search by module, line item or formula...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Module', cls: 'col-span-2', sort: function (r) { return r.module; } },
                { label: 'Line Item', cls: 'col-span-2', sort: function (r) { return r.name; } },
                { label: 'Length', cls: 'col-span-1', sort: function (r) { return r.length; } },
                { label: 'IFs', cls: 'col-span-1', sort: function (r) { return r.ifs; } },
                { label: 'Depth', cls: 'col-span-1', sort: function (r) { return r.depth; } },
                { label: 'Formula', cls: 'ia-span-5', sort: function (r) { return r.formula; } }],
      key: function (r) { return r.module + ' ' + r.name + ' ' + r.id + ' ' + r.formula; },
      cells: function (r) {
        var li = idCell(r.name, r.id);
        li.classList.add('col-span-2');
        return [textCell(r.module, 'col-span-2 text-sm text-foreground'), li,
                textCell(nf.format(r.length), 'col-span-1 text-sm text-foreground ia-num'),
                textCell(String(r.ifs), 'col-span-1 text-sm text-foreground ia-num'),
                textCell(String(r.depth), 'col-span-1 text-sm text-foreground ia-num'),
                formulaCell(r.formula, 'ia-span-5')];
      },
      csvRow: function (r) {
        return { Module: r.module, LineItem: r.name, LineItemId: r.id, Length: r.length, IFs: r.ifs, Depth: r.depth, Formula: r.formula };
      },
      filename: 'complex-formulas.csv'
    }
  ]
});

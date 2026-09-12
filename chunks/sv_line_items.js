/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell } from './sv_shared.js';

/* SV Line Items - one row per (Saved View, Line Item) that view explicitly
   selects on a Page, Rows or Columns axis. This is the set of items the view
   displays, not the filters it applies - for filter conditions see SV
   Filters. An axis left on "all items" has no explicit selection to read, so
   it contributes no rows here. See IA_viewLineItems() in
   content-scripts/inner.js. */
renderPage({
  page: 'sv_line_items',
  heading: 'Line Items in Saved Views',
  note: 'Only axes with specific Line Items selected are listed - a view left showing all Line ' +
        'Items on an axis has no explicit selection to read.',
  placeholder: 'Search by module, saved view or line item...',
  filename: 'saved-view-line-items.csv',
  cols: 'grid-cols-3',
  headers: [{ label: 'Module' }, { label: 'Saved View' }, { label: 'Line Item' }],
  key: function (r) {
    return r.moduleName + ' ' + r.savedViewName + ' ' + r.lineItemName;
  },
  cells: function (r) {
    return [textCell(r.moduleName), textCell(r.savedViewName), textCell(r.lineItemName)];
  },
  csvRow: function (r) {
    return {
      Module: r.moduleName,
      SavedView: r.savedViewName,
      LineItem: r.lineItemName
    };
  }
});

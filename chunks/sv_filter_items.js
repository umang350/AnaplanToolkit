/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell } from './sv_shared.js';

/* SV Filters - one row per filter *condition* on a saved view, with the
   condition itself, not just the line item it is applied to.

   This page used to be compiled Svelte (chunks/sv_filter_items-*.js) listing
   one row per entity named by a filter - a line item, or the context it is
   evaluated in - with no way to tell "Is Active = true" from "Is Active =
   false". The settings were always in the payload: sortAndFilterDefinition
   carries filterConditions[] (the rule) alongside filterConditionInfos[] (its
   labels), and only the latter was ever read. Hand-written here because a
   column cannot be added to a compiled chunk with no source. See IA_cond() in
   content-scripts/inner.js for the extraction. */
renderPage({
  page: 'sv_filter_items',
  heading: 'Saved View Filters',
  note: 'One row per filter condition. Match is how a view combines its own conditions ' +
        '(ALL = every condition must hold, ANY = one is enough); Context is the dimension ' +
        'a condition is evaluated against, where it has one.',
  placeholder: 'Search by module, saved view, line item or condition...',
  filename: 'saved-view-filters.csv',
  cols: 'grid-cols-5',
  headers: [
    { label: 'Module' },
    { label: 'Saved View' },
    { label: 'Line Item' },
    { label: 'Condition' },
    { label: 'Context' }
  ],
  key: function (r) {
    return r.moduleName + ' ' + r.savedViewName + ' ' + r.lineItemName + ' ' +
           r.condition + ' ' + r.operator + ' ' + r.contextName;
  },
  cells: function (r) {
    return [
      textCell(r.moduleName),
      textCell(r.savedViewName),
      textCell(r.lineItemName),
      textCell(r.condition || '—'),
      textCell(r.contextName || '—')
    ];
  },
  csvRow: function (r) {
    return {
      Module: r.moduleName,
      SavedView: r.savedViewName,
      LineItem: r.lineItemName,
      Condition: r.condition,
      Operator: r.operator,
      Value: r.value,
      DataType: r.dataType,
      Context: r.contextName,
      Match: r.matchType,
      Active: r.isActive ? 'Yes' : 'No'
    };
  }
});

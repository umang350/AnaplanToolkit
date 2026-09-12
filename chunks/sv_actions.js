/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell, idCell } from './sv_shared.js';

/* SV Actions - imports whose source is a Saved View.

   Scope is deliberately narrow and the note below says so on the page itself:
   only importDefinition.source is read (the same field the Actions view shows
   as "Source Identifier"), and a source is only resolved when it names a view
   in the model currently open. See the comment on IA_actionViews() in
   content-scripts/inner.js. */
renderPage({
  page: 'sv_actions',
  heading: 'Saved Views in Actions',
  note: 'Imports only - exports and processes are not scanned. Sources are resolved against ' +
        'the open model, so an import reading a Saved View in another model is not listed.',
  placeholder: 'Search by import, module or saved view...',
  filename: 'saved-views-in-actions.csv',
  cols: 'grid-cols-3',
  headers: [{ label: 'Import' }, { label: 'Module' }, { label: 'Saved View' }],
  key: function (r) {
    return r.actionName + ' ' + r.actionId + ' ' + r.moduleName + ' ' + r.savedViewName;
  },
  cells: function (r) {
    return [idCell(r.actionName, r.actionId), textCell(r.moduleName), textCell(r.savedViewName)];
  },
  csvRow: function (r) {
    return {
      Import: r.actionName,
      Id: r.actionId,
      Module: r.moduleName,
      SavedView: r.savedViewName,
      ViewId: r.viewId
    };
  }
});

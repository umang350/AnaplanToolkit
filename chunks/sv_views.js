/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, textCell, idCell } from './sv_shared.js';

/* SV Views - every Saved View defined in the model, one row per view. Read
   straight off viewInfos in the model context (main.js), so this is the one
   view that needs no Anaplan network calls of its own. */
renderPage({
  page: 'sv_views',
  heading: 'Saved Views',
  placeholder: 'Search by module or saved view...',
  filename: 'saved-views.csv',
  cols: 'grid-cols-2',
  headers: [{ label: 'Module' }, { label: 'Saved View' }],
  key: function (r) {
    return r.moduleName + ' ' + r.savedViewName;
  },
  cells: function (r) {
    return [textCell(r.moduleName), idCell(r.savedViewName, r.viewId)];
  },
  csvRow: function (r) {
    return {
      Module: r.moduleName,
      SavedView: r.savedViewName,
      ViewId: r.viewId
    };
  }
});

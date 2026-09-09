/*
 * Advanced Anaplan Tool
 * Author: Umang Chauhan
 */
import { renderPage, linkCell, textCell } from './sv_shared.js';

/* SV Screens - one row per (App page widget, Saved View) it reads from.
   Same four-column shape as the Usages and Filters views. */
renderPage({
  page: 'sv_screens',
  heading: 'Saved Views in Screens',
  placeholder: 'Search by app, page, widget or saved view...',
  filename: 'saved-views-in-screens.csv',
  cols: 'grid-cols-4',
  headers: [{ label: 'App' }, { label: 'Page' }, { label: 'Widget' }, { label: 'Saved View' }],
  key: function (r) {
    return r.appName + ' ' + r.pageName + ' ' + r.widgetTitle + ' ' + r.moduleName + ' ' + r.savedViewName;
  },
  cells: function (r) {
    return [
      textCell(r.appName),
      linkCell(r.pageName, r.pageUrl),
      textCell(r.widgetTitle),
      textCell(r.moduleName + ' › ' + r.savedViewName)
    ];
  },
  csvRow: function (r) {
    return {
      App: r.appName,
      Page: r.pageName,
      Widget: r.widgetTitle,
      Module: r.moduleName,
      SavedView: r.savedViewName,
      ViewId: r.viewId,
      PageUrl: r.pageUrl
    };
  }
});

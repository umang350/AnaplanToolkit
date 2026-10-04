/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell } from './sv_shared.js';
import { copyButton } from './structure_shared.js';

/* Process Steps - the actions each process runs, in order, with each
   import's source and target (IA_gps / IA_procSteps in
   content-scripts/inner.js), plus the imports, exports and actions no
   process runs.

   "Copy API call" puts an Anaplan Integration API v2 request on the
   clipboard, built from the ids on screen, so a process or action can be run
   from a script or a scheduler. The extension never sends it: it contacts
   Anaplan only to read, and running an action is left to whoever pastes the
   call, with their own auth token. */

var ctx = {};

var API_PATH = { Process: 'processes', Import: 'imports', Export: 'exports', Action: 'actions' };

function apiCall(type, id) {
  return 'curl -X POST "https://api.anaplan.com/2/0/workspaces/' + ctx.workspaceId +
    '/models/' + ctx.modelId + '/' + API_PATH[type] + '/' + id + '/tasks" \\\n' +
    '  -H "Authorization: AnaplanAuthToken $ANAPLAN_TOKEN" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"localeName":"en_US"}\'';
}

// `tag` shows the type beside the name; `api` adds the Copy API call button.
function actionCell(type, id, name, cls, tag, api) {
  var c = idCell(name, id);
  c.classList.add(cls);
  if (tag) c.firstChild.appendChild(el('span', 'ia-tag', type));
  if (api && API_PATH[type] && ctx.workspaceId && ctx.modelId)
    c.appendChild(copyButton('Copy API call', function () { return apiCall(type, id); },
      'Copy a curl request that runs this ' + type.toLowerCase() + ' through the Anaplan Integration API'));
  return c;
}

function steps(d) {
  ctx = d || {};
  return (d && d.steps) || [];
}

function loose(d) {
  ctx = d || {};
  return (d && d.loose) || [];
}

function stepNote(d) {
  var n = (d && d.emptyCount) || 0, of = (d && d.processCount) || 0;
  return (n ? n + ' of ' + of + (of === 1 ? ' process' : ' processes') +
    ' show no actions: either they are empty or their steps could not be read. ' : '') +
    'Copy API call copies a curl request for the Anaplan Integration API - it needs your own auth token, ' +
    'and nothing is run from here.';
}

renderPage({
  page: 'process_steps',
  placeholder: 'Search by process, action, source or target...',
  tabs: [
    {
      label: 'Steps',
      heading: 'Process Steps',
      note: stepNote,
      rows: steps,
      max: 400,
      placeholder: 'Search by process, action, source or target...',
      cols: 'grid-cols-12',
      // Sorting by process keeps each process's steps in run order (the sort is stable).
      headers: [{ label: 'Process', cls: 'col-span-3', sort: function (r) { return r.processName; } },
                { label: '#', cls: 'ia-span-1', sort: function (r) { return r.step || null; } },
                { label: 'Action', cls: 'col-span-3', sort: function (r) { return r.actionName; } },
                { label: 'Source', cls: 'col-span-3', sort: function (r) { return r.source; } },
                { label: 'Target', cls: 'col-span-2', sort: function (r) { return r.target; } }],
      key: function (r) {
        return r.processName + ' ' + r.processId + ' ' + r.actionName + ' ' + r.actionId + ' ' +
               r.actionType + ' ' + r.source + ' ' + r.target;
      },
      cells: function (r) {
        return [
          // The process's button sits on its first row only; later rows just name it.
          r.step <= 1 ? actionCell('Process', r.processId, r.processName, 'col-span-3', false, true)
                      : textCell(r.processName, 'col-span-3 text-sm text-muted-foreground'),
          textCell(r.step ? String(r.step) : '–', 'ia-span-1 text-sm text-muted-foreground ia-num'),
          r.actionId ? actionCell(r.actionType, r.actionId, r.actionName, 'col-span-3', true, true)
                     : textCell('No actions found', 'col-span-3 text-sm text-muted-foreground'),
          textCell(r.source || '–', 'col-span-3 text-xs text-muted-foreground'),
          textCell(r.target || '–', 'col-span-2 text-xs text-muted-foreground')
        ];
      },
      csvRow: function (r) {
        return { Process: r.processName, ProcessId: r.processId, Step: r.step || '',
                 Action: r.actionName, ActionId: r.actionId, ActionType: r.actionType,
                 Source: r.source, Target: r.target };
      },
      filename: 'process-steps.csv'
    },
    {
      label: 'Not in a process',
      heading: 'Not in a Process',
      note: 'Imports, exports and actions that no process runs. They may still be run from an App page ' +
            '(see Actions › Usages) or by hand.',
      rows: loose,
      max: 400,
      placeholder: 'Search by action, type, source or target...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Action', cls: 'ia-span-5', sort: function (r) { return r.actionName; } },
                { label: 'Type', cls: 'col-span-2', sort: function (r) { return r.actionType; } },
                { label: 'Source', cls: 'col-span-3', sort: function (r) { return r.source; } },
                { label: 'Target', cls: 'col-span-2', sort: function (r) { return r.target; } }],
      key: function (r) {
        return r.actionName + ' ' + r.actionId + ' ' + r.actionType + ' ' + r.source + ' ' + r.target;
      },
      cells: function (r) {
        return [
          actionCell(r.actionType, r.actionId, r.actionName, 'ia-span-5', false, true),
          textCell(r.actionType, 'col-span-2 text-sm text-foreground'),
          textCell(r.source || '–', 'col-span-3 text-xs text-muted-foreground'),
          textCell(r.target || '–', 'col-span-2 text-xs text-muted-foreground')
        ];
      },
      csvRow: function (r) {
        return { Action: r.actionName, ActionId: r.actionId, ActionType: r.actionType,
                 Source: r.source, Target: r.target };
      },
      filename: 'actions-not-in-a-process.csv'
    }
  ]
});

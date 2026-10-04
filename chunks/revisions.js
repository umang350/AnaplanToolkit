/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell } from './sv_shared.js';
import { stackCell } from './structure_shared.js';

/* Revisions - the model's revision tags, newest first, and every model each
   one was applied to (IA_grev in content-scripts/inner.js: the
   GET_MODEL_REVISIONS call Anaplan's own Revision tags page makes). The
   Applied To tab is that page's "Revision applied to" popup, for every tag
   at once. Read-only: nothing here adds, compares or syncs. */

// Anaplan sends UTC ISO times; show them in the viewer's time zone.
function when(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return iso;
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function revs(d) { return (d && d.revisions) || []; }
function applied(d) { return (d && d.applied) || []; }

function titleCell(r) {
  var wrap = el('div', 'ia-span-4 min-w-0'), t = el('p', 'text-sm text-foreground', r.title || 'Untitled');
  if (r.synced) t.appendChild(el('span', 'ia-tag', 'Synced'));
  if (r.current) t.appendChild(Object.assign(el('span', 'ia-tag', 'Current'),
    { title: 'The model\'s definition still matches this revision' }));
  wrap.appendChild(t);
  if (r.description) wrap.appendChild(el('p', 'text-xs text-muted-foreground', r.description));
  return wrap;
}

renderPage({
  page: 'revisions',
  placeholder: 'Search by title, description, user or model...',
  tabs: [
    {
      label: 'Revision Tags',
      heading: 'Revision Tags',
      note: 'Newest first. Synced: this model received the tag by sync, import or copy. ' +
            'Current: the model\'s definition still matches the tag.',
      rows: revs,
      placeholder: 'Search by title, description, user or model...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Title', cls: 'ia-span-4', sort: function (r) { return r.title; } },
                { label: 'Created by', cls: 'col-span-3', sort: function (r) { return r.createdBy; } },
                { label: 'Created on', cls: 'col-span-2', sort: function (r) { return r.createdOn; } },
                { label: 'Created in', cls: 'col-span-3', sort: function (r) { return r.createdInModel; } }],
      key: function (r) {
        return r.title + ' ' + r.description + ' ' + r.createdBy + ' ' + r.createdInModel + ' ' + r.createdInWorkspace;
      },
      cells: function (r) {
        return [
          titleCell(r),
          textCell(r.createdBy || '–', 'col-span-3 text-sm text-foreground'),
          // Date over time: one line doesn't fit the column in a narrow panel.
          stackCell(when(r.createdOn) ? when(r.createdOn).split(' ') : ['–'], 'col-span-2'),
          stackCell([r.createdHere ? 'This model' : r.createdInModel || '–',
                     !r.createdHere && r.createdInWorkspace,
                     r.targets ? 'Applied to ' + r.targets + (r.targets === 1 ? ' model' : ' models') : ''], 'col-span-3')
        ];
      },
      csvRow: function (r) {
        return { Title: r.title, Description: r.description, CreatedBy: r.createdBy, CreatedOn: when(r.createdOn),
                 CreatedInModel: r.createdInModel, CreatedInWorkspace: r.createdInWorkspace,
                 Synced: r.synced ? 'Yes' : 'No', Current: r.current ? 'Yes' : 'No', Type: r.type,
                 AppliedTo: r.targets };
      },
      filename: 'revision-tags.csv'
    },
    {
      label: 'Applied To',
      heading: 'Applied To',
      note: 'Every model each revision tag was applied to - the "Revision applied to" list on Anaplan\'s Revision tags page.',
      rows: applied,
      placeholder: 'Search by revision, model, workspace or user...',
      cols: 'grid-cols-12',
      headers: [{ label: 'Revision', cls: 'col-span-3', sort: function (r) { return r.revision; } },
                { label: 'Model', cls: 'ia-span-4', sort: function (r) { return r.model; } },
                { label: 'How', cls: 'col-span-2', sort: function (r) { return r.how; } },
                { label: 'When', cls: 'col-span-3', sort: function (r) { return r.on; } }],
      key: function (r) {
        return r.revision + ' ' + r.model + ' ' + r.workspace + ' ' + r.how + ' ' + r.by;
      },
      cells: function (r) {
        var m = stackCell([r.model || r.modelId, r.workspace], 'ia-span-4');
        if (r.here) m.firstChild.appendChild(el('span', 'ia-tag', 'This model'));
        if (r.deleted) m.appendChild(el('p', 'text-xs ia-error', 'Deleted ' + when(r.deleted)));
        return [
          textCell(r.revision || '–', 'col-span-3 text-sm text-foreground'),
          m,
          textCell(r.how || '–', 'col-span-2 text-xs text-muted-foreground'),
          stackCell([when(r.on), r.by && 'by ' + r.by], 'col-span-3')
        ];
      },
      csvRow: function (r) {
        return { Revision: r.revision, Model: r.model, ModelId: r.modelId, Workspace: r.workspace,
                 WorkspaceId: r.workspaceId, How: r.how, On: when(r.on), By: r.by, Deleted: when(r.deleted) };
      },
      filename: 'revision-tags-applied-to.csv'
    }
  ]
});

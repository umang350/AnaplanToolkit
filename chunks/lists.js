/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell } from './sv_shared.js';
import { formulaCell, missingNote } from './structure_shared.js';

/* Lists & Properties - every list with its parent, and every list property
   with its format and formula, off the in-page model cache (IA_structure in
   content-scripts/main.js; no Anaplan calls). Item counts are shown only when
   the cache carries them - it does not on every model. */

var nf = new Intl.NumberFormat();

function lists(d) { return (d && d.lists) || []; }
function props(d) { return (d && d.properties) || []; }

function listNote(d) {
  var ls = lists(d), keys = ((d && d.shape) || {}).listInfo, parts = [];
  if (ls.length && !ls.some(function (l) { return l.items != null; }))
    parts.push('Item counts are not in Anaplan\'s in-page model data for this model.');
  if (ls.length && !props(d).length && !ls.some(function (l) { return l.parent; }))
    parts.push(missingNote('list parents and properties', keys));
  return parts.join(' ');
}

function propNote(d) {
  var ps = props(d), keys = ((d && d.shape) || {}).propertyInfo,
      fmt = ps.some(function (p) { return p.format; }),
      fx = ps.some(function (p) { return p.formula; });
  if (!ps.length || fmt || fx) return '';
  return missingNote('property formats and formulas', keys);
}

renderPage({
  page: 'lists',
  placeholder: 'Search by list, ID or parent...',
  tabs: [
    {
      label: 'Lists',
      heading: 'Lists',
      note: listNote,
      rows: lists,
      max: 400,
      placeholder: 'Search by list, ID or parent...',
      cols: 'grid-cols-12',
      headers: [{ label: 'List', cls: 'ia-span-4' }, { label: 'Parent', cls: 'col-span-3' },
                { label: 'Items', cls: 'col-span-2' }, { label: 'Properties', cls: 'col-span-3' }],
      key: function (l) { return l.name + ' ' + l.id + ' ' + l.parent; },
      cells: function (l) {
        var name = idCell(l.name, l.id);
        name.classList.add('ia-span-4');
        if (l.numbered) name.firstChild.appendChild(el('span', 'ia-tag', 'Numbered'));
        return [
          name,
          textCell(l.parent || '–', 'col-span-3 text-sm text-foreground'),
          textCell(l.items == null ? '–' : nf.format(l.items), 'col-span-2 text-sm text-foreground ia-num'),
          textCell(l.properties ? String(l.properties) : '–', 'col-span-3 text-sm text-foreground ia-num')
        ];
      },
      csvRow: function (l) {
        return { List: l.name, ListId: l.id, Parent: l.parent, Items: l.items, Numbered: l.numbered,
                 TopLevel: l.topLevel, Properties: l.properties };
      },
      filename: 'lists.csv'
    },
    {
      label: 'Properties',
      heading: 'List Properties',
      note: propNote,
      rows: props,
      max: 400,
      placeholder: 'Search by list, property, format or formula...',
      cols: 'grid-cols-12',
      headers: [{ label: 'List', cls: 'col-span-3' }, { label: 'Property', cls: 'col-span-3' },
                { label: 'Format', cls: 'col-span-2' }, { label: 'Formula', cls: 'ia-span-4' }],
      key: function (p) { return p.list + ' ' + p.name + ' ' + p.id + ' ' + p.format + ' ' + p.formula; },
      cells: function (p) {
        var name = idCell(p.name, p.id);
        name.classList.add('col-span-3');
        return [
          textCell(p.list, 'col-span-3 text-sm text-foreground'),
          name,
          textCell(p.format || '–', 'col-span-2 text-sm text-foreground'),
          formulaCell(p.formula, 'ia-span-4')
        ];
      },
      csvRow: function (p) {
        return { List: p.list, ListId: p.listId, Property: p.name, PropertyId: p.id,
                 Format: p.format, Formula: p.formula };
      },
      filename: 'list-properties.csv'
    }
  ]
});

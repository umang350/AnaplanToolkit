/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell, linkCell } from './sv_shared.js';
import { joined, stackCell } from './structure_shared.js';

/* Modules - every module with its ID, dimensions and counts, and the App
   pages that read it. Structure comes off the in-page model cache
   (IA_structure in content-scripts/main.js); the pages are the same /pages
   list Linked Pages reads (IA_gmod in content-scripts/inner.js). When the
   cache names no applies-to on the module itself, its dimensions are the
   union of its line items' applies-to, and the note says so. */

var PAGES_SHOWN = 3;

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

function modules(d) {
  return (d && d.modules) || [];
}

function note(d, extra) {
  var parts = [];
  if (d && d.pagesError) parts.push('App pages could not be read (' + d.pagesError + '), so no module shows any pages.');
  if (modules(d).some(function (m) { return m.dimsFromItems; }))
    parts.push('Dimensions are combined from each module\'s line items\' Applies To.');
  if (extra) parts.push(extra);
  return parts.join(' ');
}

function pagesCell(m) {
  var wrap = el('div', 'col-span-3 min-w-0'), ps = m.pages || [];
  if (!ps.length) { wrap.appendChild(textCell('–', 'text-sm text-muted-foreground')); return wrap; }
  ps.slice(0, PAGES_SHOWN).forEach(function (p) {
    wrap.appendChild(linkCell(p.app ? p.app + ' › ' + p.name : p.name, p.url));
  });
  if (ps.length > PAGES_SHOWN)
    wrap.appendChild(el('p', 'text-xs text-muted-foreground', '+' + (ps.length - PAGES_SHOWN) + ' more'));
  return wrap;
}

function table(label, heading, extra, keep) {
  return {
    label: label,
    heading: heading,
    note: function (d) { return note(d, extra); },
    rows: function (d) { return modules(d).filter(keep); },
    max: 400,
    placeholder: 'Search by module, ID or dimension...',
    cols: 'grid-cols-12',
    headers: [{ label: 'Module', cls: 'ia-span-4' }, { label: 'Dimensions', cls: 'col-span-3' },
              { label: 'Contents', cls: 'col-span-2' },
              { label: 'Pages', cls: 'col-span-3' }],
    key: function (m) {
      return m.name + ' ' + m.id + ' ' + joined(m.dims) + ' ' + (m.area || '');
    },
    cells: function (m) {
      var name = idCell(m.name, m.id);
      name.classList.add('ia-span-4');
      if (m.area) name.appendChild(el('p', 'text-xs text-muted-foreground', m.area));
      return [
        name,
        textCell(joined(m.dims) || '–', 'col-span-3 text-xs text-muted-foreground'),
        stackCell([plural(m.lineItems, 'line item'), plural(m.views, 'saved view')], 'col-span-2'),
        pagesCell(m)
      ];
    },
    csvRow: function (m) {
      return {
        Module: m.name,
        ModuleId: m.id,
        FunctionalArea: m.area,
        Dimensions: (m.dims || []).join('; '),
        LineItems: m.lineItems,
        SavedViews: m.views,
        PageCount: (m.pages || []).length,
        Pages: (m.pages || []).map(function (p) { return p.app ? p.app + ' > ' + p.name : p.name; }).join('; ')
      };
    },
    filename: 'modules.csv'
  };
}

renderPage({
  page: 'modules',
  placeholder: 'Search by module, ID or dimension...',
  tabs: [
    table('All', 'Modules', '', function () { return true; }),
    table('Not on a page', 'Modules Not on a Page',
          'No App page reads these. They may still feed other modules, imports, exports or classic dashboards.',
          function (m) { return !(m.pages || []).length; })
  ]
});

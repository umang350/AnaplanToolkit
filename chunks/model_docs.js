/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */

/* Model documentation and AI context, written from the reports Summary already
   has cached for the model (ia_dump): Modules, Line Items, Lists, and - when
   they are loaded - Impact (which modules feed which) and Lint. Nothing is
   fetched and nothing leaves the browser: the documentation is a file the
   user saves, the AI context is text the user copies and pastes wherever they
   choose. A report that is not loaded is simply left out. */

function get(pages, page, key) {
  var h = pages && pages[page], d = h && h.data;
  return key ? (d && d[key]) || [] : d || null;
}

function cell(v) {
  return String(v == null ? '' : v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function code(v) {
  v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return v ? '`' + v.replace(/`/g, "'") + '`' : '';
}

function stamp() { return new Date().toISOString().slice(0, 10); }

// line items by module id, in model order
function byModule(lineItems) {
  var m = new Map();
  lineItems.forEach(function (r) {
    if (!m.has(r.moduleId)) m.set(r.moduleId, []);
    m.get(r.moduleId).push(r);
  });
  return m;
}

/* module id -> {feeds: [names], fedBy: [names]} from the Impact report's links. */
function flows(pages) {
  var d = get(pages, 'impact');
  if (!d || !d.items) return null;
  var out = new Map();
  var of = function (id) { return out.get(id) || out.set(id, { feeds: new Map(), fedBy: new Map() }).get(id); };
  d.items.forEach(function (it) {
    it.usedBy.forEach(function (j) {
      var u = d.items[j];
      if (!u || u.moduleId === it.moduleId) return;
      of(it.moduleId).feeds.set(u.moduleId, u.module);
      of(u.moduleId).fedBy.set(it.moduleId, it.module);
    });
  });
  return out;
}

function names(map) { return map ? [...map.values()].sort().join(', ') : ''; }

function facts(model) {
  var lines = [];
  if (!model) return lines;
  if (model.workspaceName) lines.push('Workspace: ' + model.workspaceName);
  var c = model.counts || {};
  var parts = [['modules', 'modules'], ['lineItems', 'line items'], ['lists', 'lists'], ['savedViews', 'saved views'],
               ['actions', 'actions'], ['imports', 'imports']]
    .filter(function (x) { return typeof c[x[0]] === 'number'; })
    .map(function (x) { return c[x[0]].toLocaleString('en-US') + ' ' + x[1]; });
  if (parts.length) lines.push('Size: ' + parts.join(', '));
  return lines;
}

/* The full documentation, as Markdown. */
export function buildDocs(pages, model) {
  var mods = get(pages, 'modules', 'modules'), lis = get(pages, 'line_items', 'lineItems'),
      lists = get(pages, 'lists', 'lists'), props = get(pages, 'lists', 'properties'),
      lint = get(pages, 'lint', 'findings'), flow = flows(pages), per = byModule(lis), md = [];
  md.push('# ' + ((model && model.modelName) || 'Anaplan model') + ' - model documentation', '',
          'Generated ' + stamp() + ' by Anaplan Toolkit from the model open in the browser.', '');
  facts(model).forEach(function (l) { md.push('- ' + l); });
  md.push('');

  if (!mods.length && lis.length) {
    // Line Items alone still document the model; group them by the module name they carry.
    var seen = new Map();
    lis.forEach(function (r) { if (!seen.has(r.moduleId)) seen.set(r.moduleId, { id: r.moduleId, name: r.module, dims: [] }); });
    mods = [...seen.values()];
  }

  md.push('## Contents', '');
  if (lists.length) md.push('- [Lists](#lists)');
  md.push('- [Modules](#modules) (' + mods.length.toLocaleString('en-US') + ')');
  if (lint.length) md.push('- [Review notes](#review-notes)');
  md.push('');

  if (lists.length) {
    md.push('## Lists', '', '| List | Parent | Items | Properties |', '|---|---|---|---|');
    lists.forEach(function (l) {
      md.push('| ' + cell(l.name) + ' | ' + cell(l.parent) + ' | ' + (l.items == null ? '' : l.items) + ' | ' +
              cell(l.properties) + ' |');
    });
    md.push('');
    if (props.length) {
      md.push('### List properties', '', '| List | Property | Format | Formula |', '|---|---|---|---|');
      props.forEach(function (p) {
        md.push('| ' + cell(p.list) + ' | ' + cell(p.name) + ' | ' + cell(p.format) + ' | ' + code(p.formula).replace(/\|/g, '\\|') + ' |');
      });
      md.push('');
    }
  }

  md.push('## Modules', '');
  mods.forEach(function (m) {
    md.push('### ' + m.name, '');
    var meta = [];
    if (m.area) meta.push('Functional area: ' + m.area);
    if (m.dims && m.dims.length) meta.push('Dimensions: ' + m.dims.join(', '));
    if (m.timeScale) meta.push('Time scale: ' + m.timeScale);
    if (m.timeRange) meta.push('Time range: ' + m.timeRange);
    var f = flow && flow.get(m.id);
    if (f && f.feeds.size) meta.push('Feeds: ' + names(f.feeds));
    if (f && f.fedBy.size) meta.push('Fed by: ' + names(f.fedBy));
    if (m.pages && m.pages.length)
      meta.push('App pages: ' + m.pages.map(function (p) { return p.app ? p.app + ' > ' + p.name : p.name; }).join('; '));
    meta.forEach(function (l) { md.push('- ' + l); });
    if (meta.length) md.push('');
    var rows = per.get(m.id) || [];
    if (rows.length) {
      md.push('| Line item | Format | Applies to | Formula |', '|---|---|---|---|');
      rows.forEach(function (r) {
        md.push('| ' + cell(r.name) + ' | ' + cell(r.format) + ' | ' + cell((r.appliesTo || []).join(', ')) + ' | ' +
                code(r.formula).replace(/\|/g, '\\|') + ' |');
      });
      md.push('');
    }
  });

  if (lint.length) {
    md.push('## Review notes', '', 'Lint findings are prompts to look, not verdicts.', '');
    var by = {};
    lint.forEach(function (x) { by[x.rule] = (by[x.rule] || 0) + 1; });
    Object.keys(by).sort().forEach(function (k) { md.push('- ' + k + ': ' + by[k].toLocaleString('en-US')); });
    md.push('');
  }
  return md.join('\n');
}

/* A compact version for pasting into an AI assistant: the structure and, if
   asked, the formulas, one line per line item, cut at whole modules once it
   reaches `max` characters (about a quarter as many tokens). */
export function buildContext(pages, model, opts) {
  opts = opts || {};
  var max = opts.max || 400000, withFx = opts.formulas !== false,
      mods = get(pages, 'modules', 'modules'), lis = get(pages, 'line_items', 'lineItems'),
      lists = get(pages, 'lists', 'lists'), flow = flows(pages), per = byModule(lis), head = [], body = [];
  head.push('# Anaplan model: ' + ((model && model.modelName) || 'unnamed'));
  facts(model).forEach(function (l) { head.push(l); });
  head.push('', 'Format: each module lists its line items as "name [format] (applies to) = formula". ' +
    'Names in formulas are as Anaplan writes them. Read-only snapshot; nothing here can be changed through it.', '');
  if (lists.length) {
    head.push('## Lists');
    lists.forEach(function (l) {
      head.push('- ' + l.name + (l.parent ? ' (child of ' + l.parent + ')' : '') + (l.items != null ? ', ' + l.items + ' items' : ''));
    });
    head.push('');
  }
  if (!mods.length && lis.length) {
    var seen = new Map();
    lis.forEach(function (r) { if (!seen.has(r.moduleId)) seen.set(r.moduleId, { id: r.moduleId, name: r.module, dims: [] }); });
    mods = [...seen.values()];
  }
  var size = head.join('\n').length, used = 0;
  head.push('## Modules');
  mods.forEach(function (m) {
    var b = ['', '### ' + m.name + (m.dims && m.dims.length ? '  [' + m.dims.join(', ') + ']' : '') +
             (m.timeScale && !/^not applicable$/i.test(m.timeScale) ? '  time: ' + m.timeScale : '')];
    var f = flow && flow.get(m.id);
    if (f && f.feeds.size) b.push('feeds: ' + names(f.feeds));
    if (f && f.fedBy.size) b.push('fed by: ' + names(f.fedBy));
    (per.get(m.id) || []).forEach(function (r) {
      var ap = (r.appliesTo || []).length ? ' (' + r.appliesTo.join(', ') + ')' : '';
      b.push('- ' + r.name + (r.format ? ' [' + r.format + ']' : '') + ap +
             (withFx && r.formula ? ' = ' + String(r.formula).replace(/\s+/g, ' ').trim() : ''));
    });
    var len = b.join('\n').length + 1;
    if (size + len > max) return;
    size += len;
    used++;
    body.push(b.join('\n'));
  });
  var text = head.join('\n') + '\n' + body.join('\n') + '\n';
  if (used < mods.length)
    text += '\n(Cut for length: ' + used + ' of ' + mods.length + ' modules included.)\n';
  return { text: text, modules: mods.length, included: used, chars: text.length };
}

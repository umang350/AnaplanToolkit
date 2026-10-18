/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { renderPage, el, textCell, idCell } from './sv_shared.js';

/* Lint - checks the model's structure against Anaplan's Planual, gathered by
   IA_glint in inner.js off the in-page model cache (no Anaplan calls). Rule
   numbers and titles are the Planual's own (Classic engine pages: Modules
   2.01, Formulas 2.02, Line Items 2.03, Lists 1.05), read from the published
   pages. Each check is an approximation of its rule - `check` says exactly what
   is tested - and the Planual lists exceptions the checks cannot see, so a
   finding is a prompt to read the rule, not a verdict. H01-H04 are not Planual
   rules; they are housekeeping checks and sit on their own tab. */

var SITE = 'https://support.anaplan.com/';
var CHAPTERS = {
  '2.01': ['Modules', 'modules-b2d142a4-53fe-4809-9ace-3cd9e51547db'],
  '2.02': ['Formulas', 'formulas-80dbd4d9-a674-430c-8dd6-87f64db40d29'],
  '2.03': ['Line Items', 'line-items-76045dd1-e0dc-4477-81da-1cea8a5466b6'],
  '1.05': ['Lists', 'lists-66ad1f4c-7c96-4faf-b69f-3c012ffa1e15']
};
var RULES = {
  '1.05-03': { sev: 'warning', title: 'Avoid using List Properties',
               check: 'The list has properties.' },
  '2.01-01': { sev: 'info', title: 'Follow a consistent naming convention',
               check: 'The module name has no alphanumeric prefix such as DAT, INP, SYS, CALC, OUT, RPT or UX.' },
  '2.01-02': { sev: 'info', title: 'Use Functional Areas',
               check: 'The module has no functional area while other modules do.' },
  '2.01-03': { sev: 'warning', title: 'Create empty modules to act as separators',
               check: 'An empty module (a separator) still has dimensions - the rule says to remove the default Time dimension.' },
  '2.01-09': { sev: 'warning', title: 'Use Lookup or Constants modules',
               check: 'The formula holds a number other than 0 or 1; global assumptions belong in a constants module.' },
  '2.01-20': { sev: 'warning', title: 'Use Appropriate Dimensions for modules',
               check: 'The module has seven or more dimensions.' },
  '2.02-01': { sev: 'warning', title: 'Nested IFs',
               check: 'The formula has six or more IFs (counted, not their nesting).' },
  '2.02-03': { sev: 'info', title: 'Evaluate use of repeated expressions carefully',
               check: 'Another line item has the same formula (25+ characters).' },
  '2.02-08': { sev: 'warning', title: 'Avoid combining SUM and LOOKUP',
               check: 'The formula uses both [SUM: ...] and [LOOKUP: ...].' },
  '2.02-10': { sev: 'info', title: 'Use PREVIOUS rather than CUMULATE',
               check: 'The formula uses CUMULATE. Fine on a short timescale (2.02-10a).' },
  '2.02-11': { sev: 'warning', title: 'Avoid using TEXTLIST()', check: 'The formula uses TEXTLIST.' },
  '2.02-14': { sev: 'warning', title: 'Avoid using SELECT',
               check: 'The formula uses [SELECT: ...] (Classic). Fine for Versions or a list\'s top level (2.02-14a, b).' },
  '2.02-18': { sev: 'info', title: 'Break up formulas',
               check: 'The formula is over 500 characters.' },
  '2.02-20': { sev: 'warning', title: 'Don\'t use RANK formulas with large lists',
               check: 'The formula uses RANK, RANKCUMULATE or ISFIRSTOCCURRENCE.' },
  '2.02-21': { sev: 'info', title: 'Avoid Using TIMESUM with Time',
               check: 'The formula uses TIMESUM; the rule is about line items applied to Time.' },
  '2.03-02': { sev: 'info', title: 'Avoid using TEXT formats', check: 'The line item has a Text format.' },
  '2.03-03': { sev: 'info', title: 'Format headers and separators as \'No Data\'',
               check: 'A line item named like a separator (---, ___, ===) with no formula is not No Data.' },
  H01: { sev: 'info', title: 'Not used by any formula', house: true,
         check: 'No formula reads this line item. It may still feed a page, saved view, import, export or process.' },
  H02: { sev: 'info', title: 'Odd spacing in the name', house: true,
         check: 'Leading, trailing or doubled spaces (shown as ·) break references written by hand.' },
  H03: { sev: 'info', title: 'List is empty', house: true, check: 'The list has no items.' },
  H04: { sev: 'info', title: 'List not used', house: true,
         check: 'No module or line item applies to it and no list is its child (formulas are not checked).' }
};
var SEV = { warning: 0, info: 1 };

function findings(d) { return (d && d.findings) || []; }

function sevOf(f) { return (RULES[f.rule] || {}).sev || 'info'; }

function tag(sev) {
  var t = el('span', 'ia-tag', sev === 'warning' ? 'Warning' : 'Info');
  if (sev === 'warning') t.classList.add('ia-tag-warn');
  return t;
}

function top(d) {
  var by = {};
  findings(d).forEach(function (f) { by[f.rule] = (by[f.rule] || 0) + 1; });
  var box = el('div', 'ia-lint-chips'), keys = Object.keys(by).sort(function (a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  });
  if (!keys.length) {
    box.appendChild(el('p', 'text-sm text-foreground', 'Nothing to flag.'));
    return box;
  }
  /* Compact chips, one per rule; clicking one searches for its code. */
  keys.forEach(function (k) {
    var r = RULES[k] || { title: k, check: '' },
        b = el('button', 'ia-lint-chip' + (r.sev === 'warning' ? ' ia-lint-warn' : ''), k + ' · ' + by[k].toLocaleString());
    b.type = 'button';
    b.title = r.title + ' - ' + r.check;
    b.addEventListener('click', function () {
      var inp = document.querySelector('input[data-slot="input-group-control"]');
      if (!inp) return;
      inp.value = inp.value === k ? '' : k;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    box.appendChild(b);
  });
  return box;
}

function note(d) {
  var c = (d && d.counts) || {};
  return 'Checked ' + (c.modules || 0).toLocaleString() + ' modules, ' + (c.lineItems || 0).toLocaleString() +
    ' line items and ' + (c.lists || 0).toLocaleString() + ' lists against the Planual (Classic engine). Each check approximates its rule: ' +
    'hover a rule for what is tested, open it for the exceptions. Findings are prompts to look, not verdicts.';
}

function table(label, heading, keep) {
  return {
    label: label,
    heading: heading,
    note: note,
    top: top,
    /* By rule number, so a rule's findings sit together. */
    rows: function (d) {
      if (!d) return [];
      var all = d.sorted || (d.sorted = findings(d).slice().sort(function (a, b) {
        return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
      }));
      return all.filter(keep);
    },
    max: 400,
    placeholder: 'Search by rule, module, line item or detail...',
    cols: 'grid-cols-12',
    headers: [{ label: 'Level', cls: 'ia-span-1', sort: function (f) { return SEV[sevOf(f)]; } },
              { label: 'Planual rule', cls: 'col-span-3', sort: function (f) { return f.rule; } },
              { label: 'Module', cls: 'col-span-2', sort: function (f) { return f.module; } },
              { label: 'Line Item', cls: 'col-span-2', sort: function (f) { return f.item; } },
              { label: 'Detail', cls: 'ia-span-4', sort: function (f) { return f.detail; } }],
    key: function (f) {
      var r = RULES[f.rule] || {};
      return f.rule + ' planual ' + (r.title || '') + ' ' + f.module + ' ' + f.item + ' ' + f.detail;
    },
    cells: function (f) {
      var r = RULES[f.rule] || { title: f.rule, check: '' }, rule = el('div', 'min-w-0 col-span-3');
      rule.title = r.check;
      rule.appendChild(el('p', 'text-sm text-foreground', r.title));
      var ch = CHAPTERS[f.rule.slice(0, 4)], ref = el('p', 'text-xs text-muted-foreground');
      if (ch) {
        var a = el('a', 'hover:underline', 'Planual ' + f.rule);
        a.href = SITE + ch[1];
        a.target = '_blank';
        a.rel = 'noreferrer';
        ref.appendChild(a);
      } else ref.textContent = 'Housekeeping ' + f.rule;
      rule.appendChild(ref);
      var sev = el('div', 'ia-span-1');
      sev.appendChild(tag(sevOf(f)));
      var li = f.item ? idCell(f.item, f.id) : textCell('–', 'text-xs text-muted-foreground');
      li.classList.add('col-span-2');
      return [sev, rule, textCell(f.module, 'col-span-2 text-sm text-foreground'), li,
              textCell(f.detail || '', 'ia-span-4 text-xs text-muted-foreground')];
    },
    csvRow: function (f) {
      var r = RULES[f.rule] || {};
      return { Severity: sevOf(f), PlanualRule: /^H/.test(f.rule) ? '' : f.rule, Rule: r.title, Module: f.module, ModuleId: f.moduleId,
               LineItem: f.item, LineItemId: f.id, Detail: f.detail };
    },
    filename: 'lint-' + label.toLowerCase() + '.csv'
  };
}

renderPage({
  page: 'lint',
  placeholder: 'Search by rule, module, line item or detail...',
  tabs: [
    table('Planual', 'Planual Findings', function (f) { return !(RULES[f.rule] || {}).house; }),
    table('Warnings', 'Planual Warnings', function (f) { return !(RULES[f.rule] || {}).house && sevOf(f) === 'warning'; }),
    table('Housekeeping', 'Housekeeping (not Planual rules)', function (f) { return !!(RULES[f.rule] || {}).house; })
  ]
});

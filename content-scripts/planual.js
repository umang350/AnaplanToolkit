/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 *
 * Planual checks on one line item - its formula text, name and format - shared by the formula editor
 * and Blueprint grid (formula.js, MAIN world) and the Lint report (inner.js, isolated world), which is
 * why this is a plain script that defines globals and loads before both. Rule numbers and titles are
 * Anaplan's own, read off the published Planual pages (Classic engine: Modules 2.01, Formulas 2.02,
 * Line Items 2.03, Lists 1.05); each check only approximates its rule, and the Planual's exceptions
 * (2.02-10a, 2.02-14a/b ...) cannot be seen from here. Checks that need the whole model (repeated
 * formulas, unused line items, module and list rules) are in Lint only (IA_lintRun in inner.js).
 * chunks/lint.js carries its own copy of these titles for its table - keep the two in step.
 * Pure and dependency-free so it can be tested without a browser.
 */
var IA_PLANUAL_SITE = 'https://support.anaplan.com/';
var IA_PLANUAL_PAGES = {
  '2.01': 'modules-b2d142a4-53fe-4809-9ace-3cd9e51547db',
  '2.02': 'formulas-80dbd4d9-a674-430c-8dd6-87f64db40d29',
  '2.03': 'line-items-76045dd1-e0dc-4477-81da-1cea8a5466b6',
  '1.05': 'lists-66ad1f4c-7c96-4faf-b69f-3c012ffa1e15'
};
var IA_PLANUAL = {
  '2.01-09': { sev: 'warning', title: 'Use Lookup or Constants modules',
               check: 'The formula holds a number other than 0 or 1; global assumptions belong in a constants module.' },
  '2.02-01': { sev: 'warning', title: 'Nested IFs', check: 'The formula has six or more IFs (counted, not their nesting).' },
  '2.02-08': { sev: 'warning', title: 'Avoid combining SUM and LOOKUP', check: 'The formula uses both [SUM: ...] and [LOOKUP: ...].' },
  '2.02-10': { sev: 'info', title: 'Use PREVIOUS rather than CUMULATE', check: 'The formula uses CUMULATE. Fine on a short timescale (2.02-10a).' },
  '2.02-11': { sev: 'warning', title: 'Avoid using TEXTLIST()', check: 'The formula uses TEXTLIST.' },
  '2.02-14': { sev: 'warning', title: 'Avoid using SELECT',
               check: 'The formula uses [SELECT: ...] (Classic). Fine for Versions or a list\'s top level (2.02-14a, b).' },
  '2.02-18': { sev: 'info', title: 'Break up formulas', check: 'The formula is over 500 characters.' },
  '2.02-20': { sev: 'warning', title: 'Don\'t use RANK formulas with large lists',
               check: 'The formula uses RANK, RANKCUMULATE or ISFIRSTOCCURRENCE.' },
  '2.02-21': { sev: 'info', title: 'Avoid Using TIMESUM with Time',
               check: 'The formula uses TIMESUM; the rule is about line items applied to Time.' },
  '2.03-02': { sev: 'info', title: 'Avoid using TEXT formats', check: 'The line item has a Text format.' },
  '2.03-03': { sev: 'info', title: 'Format headers and separators as \'No Data\'',
               check: 'A line item named like a separator (---, ___, ===) with no formula is not No Data.' }
};

function IA_planualUrl(rule) {
  var p = IA_PLANUAL_PAGES[String(rule).slice(0, 4)];
  return p ? IA_PLANUAL_SITE + p : '';
}

/* The formula with text, quoted names and comments blanked to spaces of the same length, so a match
   in it is at the same offset in the real formula. */
function IA_planualBlank(f) {
  var b = function (m) { return m.replace(/[^\n]/g, ' '); };
  return String(f || '').replace(/"(?:[^"]|"")*"/g, b).replace(/'(?:[^']|'')*'/g, b)
    .replace(/\/\*[\s\S]*?\*\//g, b).replace(/\/\/[^\n]*/g, b);
}

/* -> [{rule, detail, s, e}] ; s/e are offsets in the formula, -1 when the finding is about the line
   item rather than a place in its formula. name and fmt are optional (the editor has neither):
   fmt is Anaplan's data type ("TEXT", "NONE") or its display name ("Text", "No Data"). */
function IA_planualCheck(f, name, fmt) {
  var out = [];
  function add(rule, detail, s, e) { out.push({ rule: rule, detail: detail || '', s: s == null ? -1 : s, e: e == null ? -1 : e }); }
  f = String(f || '');
  name = String(name || '');
  fmt = String(fmt || '');
  var sep = /^\s*[-_=*~.]{3,}/.test(name);
  if (name) {
    if (sep) { if (!f && !/^(no data|none)$/i.test(fmt)) add('2.03-03', 'Format is ' + (fmt || 'not set')); }
    else if (/^text$/i.test(fmt)) add('2.03-02');
  }
  if (!f) return out;
  var c = IA_planualBlank(f), m, n = 0;
  var num = /(?<![\p{L}\p{N}_.])(\d+(?:\.\d+)?)(?![\p{L}\p{N}_])/gu;
  while ((m = num.exec(c))) {
    if (m[1] === '0' || m[1] === '1') continue;
    if (n++ < 20) add('2.01-09', m[1], m.index, m.index + m[0].length);
  }
  if (f.length > 500) add('2.02-18', f.length + ' characters', 0, Math.min(f.length, 12));
  var ifs = [], ire = /\bIF\b/gi;
  while ((m = ire.exec(c))) ifs.push(m.index);
  if (ifs.length >= 6) add('2.02-01', ifs.length + ' IFs', ifs[0], ifs[0] + 2);
  function all(re, rule, detail) {
    var x;
    while ((x = re.exec(c))) add(rule, detail, x.index, x.index + x[0].length);
  }
  all(/\[\s*SELECT\s*:/gi, '2.02-14');
  all(/\bCUMULATE(?=\s*\()/gi, '2.02-10');
  all(/\b(?:RANKCUMULATE|RANK|ISFIRSTOCCURRENCE)(?=\s*\()/gi, '2.02-20');
  all(/\bTEXTLIST(?=\s*\()/gi, '2.02-11');
  all(/\bTIMESUM(?=\s*\()/gi, '2.02-21');
  if (/\[\s*SUM\s*:/i.test(c)) all(/\[\s*LOOKUP\s*:/gi, '2.02-08', 'Both [SUM: ...] and [LOOKUP: ...]');
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IA_PLANUAL: IA_PLANUAL, IA_planualCheck: IA_planualCheck, IA_planualUrl: IA_planualUrl, IA_planualBlank: IA_planualBlank };
}

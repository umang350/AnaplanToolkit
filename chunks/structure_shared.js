/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { el } from './sv_shared.js';

/* Helpers shared by the Structure views (Modules, Line Items, Lists) and
   Process Steps. Their data is read off Anaplan's in-page model cache, whose
   shape is undocumented: main.js probes each field under the names it is
   known or likely to use, and IA_shape records the keys the cache actually
   held. A column the cache had nothing for is said so in the page note, with
   those keys, rather than left looking broken. */

// Anaplan's enum spellings ("SUM", "TIME_ENTITY") as words.
export function words(s) {
  s = s == null ? '' : String(s);
  return /^[A-Z0-9_]+$/.test(s) ? s.toLowerCase().replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : s;
}

export function joined(list) {
  return (list || []).join(', ');
}

/* A formula in mono, wrapping anywhere - Anaplan formulas are long and
   rarely have spaces where a break would look natural. */
export function formulaCell(text, cls) {
  var p = el('p', 'ia-formula' + (cls ? ' ' + cls : ''), text || '');
  if (!text) p.classList.add('ia-empty');
  return p;
}

// A cell of stacked lines: the first in normal text, the rest muted.
export function stackCell(lines, cls) {
  var wrap = el('div', 'min-w-0' + (cls ? ' ' + cls : ''));
  lines.filter(Boolean).forEach(function (t, i) {
    wrap.appendChild(el('p', i ? 'text-xs text-muted-foreground' : 'text-sm text-foreground', t));
  });
  return wrap;
}

/* "The cache held none of X for this model" notes. `keys` is IA_shape[...]
   from main.js; listing them is what lets a missing column be fixed. */
export function missingNote(what, keys) {
  return 'Anaplan\'s in-page model data did not include ' + what + ' for this model, so ' +
    (what.indexOf(' and ') > 0 ? 'those columns are' : 'that column is') + ' empty.' +
    (keys && keys.length ? ' (Fields seen: ' + keys.join(', ') + '.)' : '');
}

/* Copy-to-clipboard button. `text` may be a function, so a long value (an API
   call) is only built when clicked. */
export function copyButton(label, text, title) {
  var b = el('button', 'ia-api', label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var v = typeof text === 'function' ? text() : text;
    navigator.clipboard.writeText(v).then(function () {
      b.dataset.copied = '1';
      setTimeout(function () { delete b.dataset.copied; }, 1200);
    }, function () {});
  });
  return b;
}

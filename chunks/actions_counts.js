/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Item counts on the Actions view's tab bar ("Processes 582", "Imports 1,717", ...).
 *
 * The Actions view is compiled Svelte (chunks/actions-*.js) with no source in
 * this repository, and its tab labels are static text, so the counts are added
 * from outside: this listens for the same `actions_data` push the renderer does
 * and decorates the tab triggers once they exist. The tab bar is only rendered
 * after data arrives, so a MutationObserver re-applies the badges whenever the
 * DOM changes. Counts are totals; the search box filters the list, not these.
 */

var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;

var LISTS = ['processes', 'imports', 'exports', 'actions', 'files'];
var counts = null;

function tabKey(el) {
  var v = el.getAttribute('data-value') || el.getAttribute('value');
  if (v) return v.toLowerCase();
  var clone = el.cloneNode(true);
  clone.querySelectorAll('.ia-count').forEach(function (b) { b.remove(); });
  return clone.textContent.trim().toLowerCase();
}

function apply() {
  if (!counts) return;
  document.querySelectorAll('[role="tab"]').forEach(function (tab) {
    var key = tabKey(tab);
    if (!(key in counts)) return;
    var text = counts[key].toLocaleString();
    var badge = tab.querySelector('.ia-count');
    if (badge && badge.textContent === text) return;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ia-count';
      tab.appendChild(badge);
    }
    badge.textContent = text;
  });
}

try {
  api.runtime.onMessage.addListener(function (msg) {
    if (msg?.type !== 'actions_data' || !msg.data) return;
    var d = msg.data, all = 0;
    counts = {};
    LISTS.forEach(function (k) {
      counts[k] = (d[k] || []).length;
      all += counts[k];
    });
    counts.all = all;
    apply();
  });
} catch (e) {}

new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });

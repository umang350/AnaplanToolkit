/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Column sorting for the compiled views (Actions IDs, Usages, Linked Pages,
 * SV Filters), which are Svelte build output with no source in this
 * repository. The hand-written views sort in renderPage (chunks/sv_shared.js);
 * this gives these four the same click-a-header behaviour from outside.
 *
 * A table here is a card whose first child is the header row (`grid ...
 * border-b ... py-3` of <h3>s) followed by one `grid ... py-1` div per row,
 * each cell an element in header order. Rows are reordered with CSS `order`
 * on a flex column, never moved in the DOM, because Svelte keeps its own
 * references to those nodes (as chunks/actions_counts.js does for the tab
 * bar). The views redraw on search and tab changes, so a MutationObserver
 * re-binds new headers and re-applies the sort to new rows. Sort state is
 * kept per table (keyed by its header labels), so it survives a redraw.
 */
(function () {
  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),
      sorts = {}, busy = false;

  function isHead(el) {
    var c = el.className || '';
    return typeof c === 'string' && /\bgrid\b/.test(c) && /\bborder-b\b/.test(c) && /\bpy-3\b/.test(c) &&
      el.querySelector(':scope > h3');
  }

  function heads(head) { return [].slice.call(head.querySelectorAll(':scope > h3')); }
  function sig(head) { return heads(head).map(function (h) { return h.dataset.label || h.textContent.trim(); }).join('|'); }

  function rows(card, head) {
    return [].slice.call(card.children).filter(function (r) {
      return r !== head && /\bgrid\b/.test(r.className || '') && /\bpy-1\b/.test(r.className || '');
    });
  }

  function cellText(row, i) {
    var c = row.children[i];
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function num(s) {
    var t = s.replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? +t : null;
  }

  function apply(card, head) {
    var st = sorts[sig(head)], rs = rows(card, head);
    heads(head).forEach(function (h, i) {
      var on = st && st.col === i, mark = h.querySelector('.ia-sort-mark');
      h.setAttribute('aria-sort', on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none');
      if (mark) mark.textContent = on ? (st.dir > 0 ? ' ▲' : ' ▼') : '';
    });
    if (!st) { rs.forEach(function (r) { r.style.order = ''; }); return; }
    var keyed = rs.map(function (r, ix) { return { r: r, ix: ix, v: cellText(r, st.col) }; });
    keyed.sort(function (a, b) {
      var x = a.v, y = b.v;
      if (!x || !y) return (!x - !y) || a.ix - b.ix;
      var nx = num(x), ny = num(y),
          c = nx != null && ny != null ? nx - ny : collator.compare(x, y);
      return c * st.dir || a.ix - b.ix;
    });
    keyed.forEach(function (k, n) { k.r.style.order = String(n + 1); });
  }

  function bind(head) {
    var card = head.parentElement;
    if (!card) return;
    if (!head.dataset.iaSort) {
      head.dataset.iaSort = '1';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      head.style.order = '0';
      heads(head).forEach(function (h, i) {
        h.dataset.label = h.textContent.trim();
        h.classList.add('ia-sortable');
        h.setAttribute('role', 'button');
        h.tabIndex = 0;
        h.title = 'Sort by ' + h.dataset.label;
        h.appendChild(Object.assign(document.createElement('span'), { className: 'ia-sort-mark' }));
        var go = function () {
          var k = sig(head), cur = sorts[k];
          sorts[k] = !cur || cur.col !== i ? { col: i, dir: 1 } : cur.dir > 0 ? { col: i, dir: -1 } : null;
          apply(card, head);
        };
        h.addEventListener('click', go);
        h.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    }
    apply(card, head);
  }

  function scan() {
    if (busy) return;
    busy = true;
    try {
      document.querySelectorAll('div').forEach(function (d) { if (isHead(d)) bind(d); });
    } finally {
      busy = false;
    }
  }

  // Our own edits (order, marks) also trigger the observer; one pass per frame is plenty.
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();

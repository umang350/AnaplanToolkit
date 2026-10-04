/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Lock Monitor's eyes on Anaplan's own "Model is busy" banner.
 *
 * The banner is drawn by whichever Anaplan page is in front - the new
 * modelling experience and App pages draw it in their own frame, not in the
 * framework.jsp frame the report engine (inner.js) runs in, so inner.js could
 * not see it: the monitor said "Available" under a banner reading "Model is
 * busy". This script runs in every Anaplan frame and does nothing until the
 * monitor asks: each check, the worker sends ia_lk_frame to every frame of
 * the tab, and a frame answers only when it has seen the banner (the first
 * answer wins, so frames without it must stay silent).
 *
 * Between checks a MutationObserver remembers a banner that came and went,
 * so one shorter than a second is still counted. It is started by the first
 * ask and stopped once the monitor has not asked for WATCH_FOR, so an Anaplan
 * tab with no monitor running pays nothing.
 */
(function () {
  var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  if (!api?.runtime?.onMessage) return;

  var BUSY = /\bmodel is (?:currently )?(?:busy|locked|processing)\b/i,
      WATCH_FOR = 1e4, THROTTLE = 250;
  var seen = '', obs = null, timer = 0, stopper = 0;

  function visible(node) {
    var e = node.nodeType === 1 ? node : node.parentElement;
    if (!e || !e.getClientRects().length) return false;
    var cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  // Text nodes only (no layout pass), into open shadow roots too.
  function find(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        var s = n.nodeValue;
        if (s && s.length < 200 && BUSY.test(s) && visible(n)) return s.replace(/\s+/g, ' ').trim();
      } else {
        // The words split over a few small elements ("Model is <b>busy</b>").
        if (n.childElementCount && n.childElementCount < 4) {
          var t = n.textContent;
          if (t && t.length < 80 && BUSY.test(t) && visible(n)) return t.replace(/\s+/g, ' ').trim();
        }
        if (n.shadowRoot) {
          var hit = find(n.shadowRoot);
          if (hit) return hit;
        }
      }
    }
    return '';
  }

  function check() {
    timer = 0;
    try { var s = document.body && find(document.body); if (s) seen = s; } catch (e) {}
  }

  function watch() {
    if (!obs && document.body) {
      obs = new MutationObserver(function () { if (!timer) timer = setTimeout(check, THROTTLE); });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true,
                                   attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    clearTimeout(stopper);
    stopper = setTimeout(function () {
      if (obs) obs.disconnect();
      obs = null;
      seen = '';
    }, WATCH_FOR);
  }

  api.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || msg.type !== 'ia_lk_frame') return;
    watch();
    check();
    var s = seen;
    seen = '';
    if (!s) return;   // stay silent: another frame may have it
    try { respond({ text: s.slice(0, 160) }); } catch (e) {}
  });
})();

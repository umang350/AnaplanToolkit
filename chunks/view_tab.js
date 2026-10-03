/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Keeps a view to its own tab's traffic. Loaded as a classic script ahead of
 * every view's module, so it is in place before the view registers anything.
 *
 * On Chrome each Anaplan tab has its own side panel, alive while hidden, and
 * runtime.sendMessage reaches every extension page - so a view used to hear
 * other tabs' pushes: one tab's failed run showed its error page over another
 * tab's report. The panel loads each view with ?t=<its tab>; this drops any
 * message addressed (`to`) to a different tab, and names the tab (`forTab`) on
 * what the view sends. The compiled views can't be edited to do this
 * themselves, so it wraps the API they call instead. Without ?t= (Firefox's
 * per-window sidebar) it does nothing.
 */
(function () {
  var t = new URLSearchParams(location.search).get('t');
  if (!t || !/^\d+$/.test(t)) return;
  var tab = +t;
  [globalThis.chrome, globalThis.browser].forEach(function (ns) {
    var rt = ns && ns.runtime;
    if (!rt || !rt.id || !rt.onMessage) return;
    var ev = rt.onMessage, add = ev.addListener, send = rt.sendMessage;
    if (add && !add.iaTab) {
      var wrapAdd = function (fn) {
        return add.call(ev, function (msg) {
          if (msg && msg.to != null && msg.to !== tab) return;
          return fn.apply(this, arguments);
        });
      };
      wrapAdd.iaTab = true;
      try { ev.addListener = wrapAdd; } catch (e) {}
    }
    if (send && !send.iaTab) {
      var wrapSend = function (msg) {
        var args = [].slice.call(arguments);
        if (msg && typeof msg === 'object' && msg.forTab == null) {
          args[0] = Object.assign({}, msg, { forTab: tab });
        }
        return send.apply(rt, args);
      };
      wrapSend.iaTab = true;
      try { rt.sendMessage = wrapSend; } catch (e) {}
    }
  });
})();

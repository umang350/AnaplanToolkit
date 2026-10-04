/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Lock Monitor's door to Anaplan's Integration API (api.anaplan.com).
 *
 * The API refuses any request whose Origin is a browser extension - checked
 * live: Origin chrome-extension:// or moz-extension:// gets an
 * empty 403, Origin https://us1a.app.anaplan.com gets 200, and its CORS
 * preflight allows GET with an Authorization header and credentials from
 * any Anaplan page. So the worker can't call it itself; it hands each call
 * to this script in the tab's top frame - the Anaplan shell, which is up
 * even while the model is busy - and the request goes out as the page's.
 *
 * Only GETs to api.anaplan.com/2/0/, only when the worker asks (a page can't
 * reach this listener), with the page's own cookies. Nothing is kept here.
 *
 * ia_lk_rpc is the session path tried first: one jsonrpc REQUEST_STATUS - the
 * call Anaplan's own client uses to show "Model is busy" - POSTed to the
 * model's core (…/coreNNNN/anaplan/jsonrpc) on this page's own host, so the
 * session cookie goes with it and no token is needed. The core is read off
 * the page (the framework.jsp frame, or a request the page already made) or,
 * failing that, from the redirectUrl a jsonrpc on the wrong core answers
 * with. Nothing but REQUEST_STATUS is sent this way.
 */
(function () {
  var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  if (!api?.runtime?.onMessage || window.top !== window) return;

  var ALLOW = /^https:\/\/api\.anaplan\.com\/2\/0\//,
      // Firefox: a content script's own fetch goes out as the extension;
      // content.fetch goes out as the page, which is the point here.
      go = globalThis.content && typeof globalThis.content.fetch === 'function'
        ? globalThis.content.fetch.bind(globalThis.content) : globalThis.fetch.bind(globalThis),
      flight = new Map();

  var CORE = /^(https:\/\/[^\/?#]+\.anaplan\.com\/(?:[^?#]*?\/)?anaplan)\/(?:framework\.jsp|jsonrpc)(?:[?#]|$)/i;

  // The core this page talks to: its framework.jsp frame (same-origin frames
  // searched too), else any jsonrpc / framework.jsp the page has requested.
  function findCore() {
    var walk = function (doc, depth) {
      if (!doc || depth > 4) return '';
      var fs = doc.querySelectorAll('iframe');
      for (var i = 0; i < fs.length; i++) {
        var u = fs[i].src || '', m = CORE.exec(u);
        try { var h = fs[i].contentWindow.location.href; m = m || CORE.exec(h); } catch (e) {}
        if (m && m[1].indexOf(location.origin) === 0) return m[1];
        var inner = ''; try { inner = walk(fs[i].contentDocument, depth + 1); } catch (e) {}
        if (inner) return inner;
      }
      return '';
    };
    var b = walk(document, 0);
    if (b) return b;
    try {
      var rs = performance.getEntriesByType('resource');
      for (var i = rs.length - 1; i >= 0; i--) {
        var m = CORE.exec(rs[i].name);
        if (m && m[1].indexOf(location.origin) === 0) return m[1];
      }
    } catch (e) {}
    return location.origin + '/anaplan';
  }

  function rpc(base, body, signal) {
    return go(base + '/jsonrpc', { method: 'POST', credentials: 'include', cache: 'no-store', signal: signal,
      headers: { Accept: '*/*', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
                 'Request-Serial-Number': body.requestSerialNumber },
      body: JSON.stringify(body) })
      .then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t.slice(0, 2e4) }; }); });
  }

  api.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || sender?.id !== api.runtime.id) return;
    if (msg.type === 'ia_lk_abort') { var a = flight.get(msg.id); if (a) a.abort(); return; }
    if (msg.type === 'ia_lk_rpc') {
      var body = msg.body || {};
      if (body.requestType !== 'REQUEST_STATUS') { respond({ error: 'refused: only REQUEST_STATUS' }); return; }
      var base = CORE.exec(String(msg.base) + '/jsonrpc') && String(msg.base).indexOf(location.origin) === 0
            ? String(msg.base) : findCore(),
          ac2 = new AbortController(), tm2 = setTimeout(function () { ac2.abort(); }, msg.ms || 3e4);
      flight.set(msg.id, ac2);
      rpc(base, body, ac2.signal).then(function (r) {
        // Wrong core: the reply is only {redirectUrl: ".../coreNNNN/anaplan/framework.jsp?..."}.
        var j = null; try { j = JSON.parse(r.text); } catch (e) {}
        var m = j && !j.requestStatus && typeof j.redirectUrl === 'string' && CORE.exec(j.redirectUrl);
        if (!m || m[1].indexOf(location.origin) !== 0) return Object.assign(r, { base: base });
        base = m[1];
        return rpc(base, body, ac2.signal).then(function (r2) { return Object.assign(r2, { base: base }); });
      }).then(respond, function (e) {
        respond({ error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || String(e) });
      }).finally(function () { clearTimeout(tm2); flight.delete(msg.id); });
      return true;
    }
    if (msg.type !== 'ia_lk_fetch') return;
    if (!ALLOW.test(String(msg.url))) { respond({ error: 'refused: not an Anaplan API address' }); return; }

    var ac = new AbortController(), tm = setTimeout(function () { ac.abort(); }, msg.ms || 3e4);
    flight.set(msg.id, ac);
    go(msg.url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'include',
                  cache: 'no-store', signal: ac.signal })
      .then(function (r) { return r.text().then(function (t) { respond({ status: r.status, text: t.slice(0, 2e4) }); }); })
      .catch(function (e) { respond({ error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || String(e) }); })
      .finally(function () { clearTimeout(tm); flight.delete(msg.id); });
    return true;   // answering asynchronously
  });
})();

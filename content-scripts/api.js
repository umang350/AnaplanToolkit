/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
/*
 * Lock Monitor's door to Anaplan's Integration API (api.anaplan.com).
 *
 * The API refuses any request whose Origin is a browser extension - checked
 * with a valid token: Origin chrome-extension:// or moz-extension:// gets an
 * empty 403, Origin https://us1a.app.anaplan.com gets 200, and its CORS
 * preflight allows GET with an Authorization header and credentials from
 * any Anaplan page. So the worker can't call it itself; it hands each call
 * to this script in the tab's top frame - the Anaplan shell, which is up
 * even while the model is busy - and the request goes out as the page's.
 *
 * Only GETs to api.anaplan.com/2/0/, only when the worker asks (a page can't
 * reach this listener), with the token the worker passes or, with none, the
 * page's own cookies. Nothing is kept here.
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

  api.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || sender?.id !== api.runtime.id) return;
    if (msg.type === 'ia_lk_abort') { var a = flight.get(msg.id); if (a) a.abort(); return; }
    if (msg.type !== 'ia_lk_fetch') return;
    if (!ALLOW.test(String(msg.url))) { respond({ error: 'refused: not an Anaplan API address' }); return; }

    var ac = new AbortController(), tm = setTimeout(function () { ac.abort(); }, msg.ms || 3e4),
        h = { Accept: 'application/json' };
    if (msg.token) h.Authorization = 'AnaplanAuthToken ' + msg.token;
    flight.set(msg.id, ac);
    go(msg.url, { method: 'GET', headers: h, credentials: msg.token ? 'omit' : 'include',
                  cache: 'no-store', signal: ac.signal })
      .then(function (r) { return r.text().then(function (t) { respond({ status: r.status, text: t.slice(0, 2e4) }); }); })
      .catch(function (e) { respond({ error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || String(e) }); })
      .finally(function () { clearTimeout(tm); flight.delete(msg.id); });
    return true;   // answering asynchronously
  });
})();

/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 *
 * Bridge for the panel's settings (Summary > Settings, kept in extension storage as `ia_settings`) to
 * the formula editor helpers. formula.js runs in the page's own world and cannot read extension
 * storage, so this isolated-world script - on the same frames - copies each setting onto the document
 * element as a data attribute (data-ia-planual-grid / data-ia-planual-editor, "on" | "off"), which
 * formula.js reads. A missing setting is on. Reads storage only; sends nothing anywhere.
 */
(function () {
  var api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
  if (!api || !api.storage || !api.storage.local) return;
  function apply(s) {
    s = s || {};
    var d = document.documentElement;
    if (!d) return;
    d.dataset.iaPlanualGrid = s.planualGrid === false ? 'off' : 'on';
    d.dataset.iaPlanualEditor = s.planualEditor === false ? 'off' : 'on';
  }
  try {
    Promise.resolve(api.storage.local.get('ia_settings')).then(function (r) { apply(r && r.ia_settings); }, function () {});
    api.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.ia_settings) apply(ch.ia_settings.newValue);
    });
  } catch (e) { /* the extension was reloaded under this frame; nothing to bridge */ }
})();

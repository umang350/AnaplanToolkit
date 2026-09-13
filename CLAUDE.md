# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 extension ("Anaplan Toolkit"), shipped for both Chrome and Firefox, that reports on
the structure of the Anaplan model open in the active tab. Nine read-only views, each gathered on
demand, cached, and exportable to CSV. Proprietary internal tool — see `LICENSE.txt` and
`NOTICE.txt` (parts derive from valantic's "Improved Anaplan"; confirm redistribution rights before
shipping anywhere).

## Commands

There is **no npm project, no bundler, no test suite, and no lint step** — the repository *is* the
extension. Everything shipped is plain JS loaded directly by the browser. `package.sh` needs `jq`
on `PATH` (only for the Firefox manifest tweak below).

```sh
sh package.sh          # copy the manifest-referenced files into dist/ (Chrome) and
                        # dist-firefox/ (Firefox), zipped to anaplan-toolkit.zip and
                        # anaplan-toolkit-firefox.zip
```

To run it in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → this folder (or
`dist/`). In Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → any file
in `dist-firefox/` (a temporary add-on is unloaded on browser restart; there is no unpacked-folder
loader in Firefox the way there is in Chrome). After editing a content script you must reload the
extension **and** reload the Anaplan tab — an extension reload orphans content scripts in
already-open frames, and `background.js` reports that condition with a dedicated error message
rather than retrying.

`dist/`, `dist-firefox/` and the two zips are committed build output. `package.sh` deletes and
regenerates all four, so re-run it after any change to a shipped file or they will drift from
source. `package.sh` maintains an explicit allowlist of top-level files — **a new top-level
HTML/JS/CSS file must be added to that list or it will be missing from the package** (the script
hard-fails only on files that are listed but absent, not on files present but unlisted).

## Cross-browser support

`background.js`, `sidepanel.js` and every content script resolve the extension API with
`globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome` before doing anything
else (Firefox exposes the promise-based `browser.*` namespace; Chrome only has the
callback/promise-hybrid `chrome.*`). Keep new code going through that resolved object rather than
calling `chrome.*`/`browser.*` directly, or it will silently fail on whichever browser it skipped.

Chrome and Firefox disagree on how the side panel works, and both accommodations live in
`background.js`, not behind a build flag:
- **Manifest.** `manifest.json` carries both browsers' keys side by side — `side_panel` +
  `sidebar_action`, and `background.service_worker` + `background.scripts` — each ignored by the
  browser that doesn't recognise it. The one thing that can't coexist is the `sidePanel`
  *permission string*, which Firefox's manifest validator rejects outright; `package.sh` strips it
  from `dist-firefox/manifest.json` with `jq`.
- **Opening the panel.** Chrome opens the side panel via `chrome.sidePanel.open()` (wired to the
  toolbar icon with `setPanelBehavior({openPanelOnActionClick:true})`). Firefox has no equivalent
  API — `openPanel()` in `background.js` falls back to `api.sidebarAction.open()`, and `main()`
  wires the toolbar icon to `api.sidebarAction.toggle()` directly since there is no
  `openPanelOnActionClick` there.
- **`world: "MAIN"` content scripts** (used by `main.js` to reach Anaplan's in-page model cache)
  need Firefox 128+, hence `browser_specific_settings.gecko.strict_min_version: "128.0"` in the
  manifest.

## Architecture

Three separate JS worlds cooperate; understanding the split is the key to this codebase.

```
sidepanel.html/js/css   side panel shell: tab bar, "Get data" button, progress list,
  └─ <iframe> ×7        one lazily created iframe per view (actions.html, pages.html, …)
background.js           service worker: message router, per-model cache, watchdogs
content-scripts/
  outer.js              ISOLATED world on the modeling-ui frame — keyboard shortcuts only
  inner.js              ISOLATED world on framework.jsp — the report engine
  main.js               MAIN world on framework.jsp — reads Anaplan's in-page model cache
```

**Why three content scripts.** Anaplan's model metadata lives in page JS (`anaplan.data.
ModelContentCache._modelInfo`), reachable only from the MAIN world. `main.js` reads it and answers
`REQUEST_ANAPLAN_DATA` over `window.postMessage`; `inner.js` (`P()`) asks and re-pings on a
1.5s/5s/15s schedule before failing at 45s, because `main.js`'s listener may not be registered when
`inner.js` first asks. `main.js` **always** replies — an error payload rather than silence — since a
missing reply used to hang the spinner forever. `outer.js` runs on a different Anaplan URL
(`modeling-ui`) than the other two (`framework.jsp`) and only relays keyboard shortcuts.

**Data flow for one view.** Panel sends `ia_load`/`ia_refresh` → worker resolves an Anaplan tab and
`tabs.sendMessage`es `trigger_<page>` → `inner.js` acks immediately (`{started:true}`; a gather runs
for minutes, far longer than the message channel lives), then works and reports via `ia_progress`,
finishing with `<page>_data` → worker caches it and pushes `ia_state` → the panel asks `ia_serve` →
worker pushes `<page>_data` at the iframe. The worker **never** pushes data unsolicited:
`runtime.sendMessage` resolves as soon as *any* extension page listens, so a push sent before the
iframe exists looks delivered and is lost.

**Caching.** `chrome.storage.session` + an in-memory `Map`, keyed `ia:<page>:<customerId>:<modelId>`
with a 6h max age, so switching model never shows stale data. `inner.js` probes with `cache_get`
*before* making Anaplan calls, so a hit skips the expensive work entirely. Separately, `IA_vc` in
`inner.js` memoizes the jsonrpc saved-view fetch within a page session (cleared on force-refresh).

**Watchdogs.** A gather can die silently (frame torn down, orphaned script, stalled request), which
would leave the spinner up forever. `background.js` arms `FIRST_SIGN` (15s) on trigger and re-arms
`STALL` (240s, above the content script's 90s + one retry ceiling) on every progress tick.
`ia_busy`/`ia_progress` carry a monotonic `seq` so the panel drops out-of-order pushes.

**Anaplan endpoints.** Only two, both using the existing session cookie: the springboard definition
service (`/a/springboard-definition-service/customer/…/pages`, and `/boards|reports|grid-pages/<guid>`
per page) and `/jsonrpc` with `requestType: VIEW_REQUEST_SET` for saved-view definitions, batched
100 views at a time. `IA_pool()` caps concurrency (8 for page definitions, 6 for view batches).
No other server is ever contacted.

## Editing constraints

- **Five of the nine view renderers have no source in this repository.** `chunks/<page>-<hash>.js`
  are committed Svelte build output (actions, action_usages, pages, filter_items, sv_filter_items).
  You cannot meaningfully edit them. Styling changes for those pages go in `views.css`, which is
  loaded after the compiled Tailwind CSS specifically to override it.
- `sv_views`, `sv_line_items`, `sv_screens` and `sv_actions` are hand-written ES modules over
  `chunks/sv_shared.js`. `sv_shared.js` deliberately re-implements the CSV writer and the fuzzy
  search scorer from `chunks/Empty-*.js` rather than importing them — that chunk's exports are
  minified single letters that would resolve to different functions if the bundle were ever
  rebuilt. Keep the two implementations in step; all nine views are expected to export and search
  identically.
- **`background.js`, `inner.js`, `outer.js` and `main.js` are minified vendor output with
  hand-written additions merged in.** Identifiers added by this project are prefixed `IA_`
  (`IA_pool`, `IA_step`, `IA_views`, `IA_screenViews`, …) to keep them clear of the single-letter
  minified names — follow that convention, and never reuse a bare single letter at module scope.
  The multi-line `/* … */` comments in these files explain past bugs; preserve them.
- Adding a view means touching all of: `PAGES` in `background.js`, `VIEWS` in `sidepanel.js`, the
  trigger map in `inner.js` (`p()`), a new `<page>.html`, a renderer, and `package.sh`.
- `popup.html` and `chunks/popup-*.js` are dead — the manifest has no `default_popup` and
  `package.sh` excludes them.

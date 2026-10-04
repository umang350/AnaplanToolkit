# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 extension ("Anaplan Toolkit"), shipped for both Chrome and Firefox, that reports on
the structure of the Anaplan model open in the active tab. Fifteen read-only report views, each
gathered on demand, cached, and exportable to CSV, plus a Summary view the panel opens on. Proprietary internal tool — see `LICENSE.txt` and
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
  `sidebar_action`, `browser_specific_settings` — each silently ignored by the browser that
  doesn't recognise it. Two things aren't silently ignored, so `package.sh` strips them from
  `dist-firefox/manifest.json` with `jq`: the `sidePanel` *permission string* (Firefox's manifest
  validator rejects it outright) and `background.service_worker` (Firefox just falls back to
  `background.scripts`, but AMO's validator warns on the unsupported key's presence).
- **Opening the panel.** Chrome opens the side panel via `chrome.sidePanel.open()` (wired to the
  toolbar icon with `setPanelBehavior({openPanelOnActionClick:true})`). Firefox has no equivalent
  API — `openPanel()` in `background.js` falls back to `api.sidebarAction.open()`, and `main()`
  wires the toolbar icon to `api.sidebarAction.toggle()` directly since there is no
  `openPanelOnActionClick` there.
- **`world: "MAIN"` content scripts** (used by `main.js` to reach Anaplan's in-page model cache)
  need Firefox 128+ — but see below, the effective floor is higher.
- **Data collection disclosure.** AMO has required `gecko.data_collection_permissions` on every
  new extension since November 2025 — omitting it is a hard validation failure, not a warning.
  This extension talks to Anaplan only and stores nothing anywhere else, so it's set to
  `{"required": ["none"]}`. If that ever stops being true (e.g. an analytics call is added), this
  key must be updated to match or AMO will reject the submission on the mismatch. That key itself
  needs a newer Firefox than `world: "MAIN"` does, so it - not the content script world - sets the
  actual floor: `strict_min_version: "140.0"` under `gecko`, `strict_min_version: "142.0"` under
  `gecko_android`. Bump both together if this key's own minimum version ever changes.

## Architecture

Three separate JS worlds cooperate; understanding the split is the key to this codebase.

```
sidepanel.html/js/css   side panel shell: tab bar, "Get data" button, progress list,
  └─ <iframe> ×n        one lazily created iframe per view (actions.html, pages.html, …)
background.js           service worker: message router, per-model cache, watchdogs
content-scripts/
  outer.js              ISOLATED world on the modeling-ui frame — keyboard shortcuts only
  inner.js              ISOLATED world on framework.jsp — the report engine
  main.js               MAIN world on framework.jsp — reads Anaplan's in-page model cache
```

**Why three content scripts.** Anaplan's model metadata lives in page JS (`anaplan.data.
ModelContentCache._modelInfo`), reachable only from the MAIN world. `main.js` reads it and answers
`REQUEST_ANAPLAN_DATA` over `window.postMessage`; `inner.js` (`P()`) asks and re-pings every
1s before failing at 45s (8s for Summary, which the panel retries itself), because `main.js`'s listener may not be registered when
`inner.js` first asks. `main.js` **always** replies — an error payload rather than silence — since a
missing reply used to hang the spinner forever. `outer.js` runs on a different Anaplan URL
(`modeling-ui`) than the other two (`framework.jsp`) and only relays keyboard shortcuts.

**Data flow for one view.** Panel sends `ia_load`/`ia_refresh` → worker resolves an Anaplan tab (the
active tab when it is an Anaplan one, never silently another) and `tabs.sendMessage`es
`trigger_<page>` → `inner.js` acks immediately (`{started:true}`; a gather runs for minutes, far
longer than the message channel lives), then works and reports via `ia_progress`, finishing with
`ia_result {page,data,key}` → worker caches it and, only if `key` is the model the panel is showing,
pushes `ia_state` → the panel asks `ia_serve` → worker pushes `<page>_data` at the iframe. A content
script must never send `<page>_data` itself: `runtime.sendMessage` reaches every extension page, so
the view iframes would render another tab's or model's results directly. The worker **never** pushes
data unsolicited: `runtime.sendMessage` resolves as soon as *any* extension page listens, so a push
sent before the iframe exists looks delivered and is lost.

**One panel per tab (Chrome).** The global side panel is disabled; the toolbar icon enables and
opens a panel for that tab only (`panelFor()`), so several panel documents can be alive at once,
hidden ones included. Run state in the worker is keyed per tab (`rid(tab,page)`), every push names
its Anaplan tab in `to`, and panel requests carry `forTab`. The panel drops pushes for other tabs,
and `chunks/view_tab.js` (loaded first in every view HTML, which gets `?t=<tab>`) does the same for
the views by wrapping `runtime.onMessage.addListener`/`sendMessage`. Any new push must set `to`, and
any new view HTML must load `view_tab.js`. Firefox's sidebar is per window: no `forTab`, no filtering.

**Model switching.** The worker watches tab activation, window focus and navigation; when the model in
front changes it pushes `ia_context` and the panel drops every iframe and re-syncs from `ia_status`
(each model's results stay cached under their own key).

**Caching.** `chrome.storage.session` + an in-memory `Map`, keyed `ia:<page>:<customerId>:<modelId>`
with a 6h max age, so switching model never shows stale data. `storage.session` holds 10 MB in all
and Line Items on a large model is more than that alone, so `cacheSet` stores any result over
`ZIP_AT` (32 KB of JSON) gzipped as base64 (`pack`/`unpack`), and on a quota error drops other
models' then this model's older cached reports from storage (`evict`) and retries - this model's
stay in `mem`, which serves them while the worker lives. A result that only lives in `mem` is lost
when the worker idles out (~30s) - Summary then shows it "Not loaded", and the panel, told
`{hit:false}` by `ia_serve`, drops that view back to Get data with a note (`maybeServe`) rather
than leave it on its loader. `inner.js` probes with `cache_get`
*before* making Anaplan calls, so a hit skips the expensive work entirely. Separately, `IA_vc` in
`inner.js` memoizes the jsonrpc saved-view fetch within a page session (cleared on force-refresh).

**Watchdogs.** A gather can die silently (frame torn down, orphaned script, stalled request), which
would leave the spinner up forever. `background.js` arms `FIRST_SIGN` (15s) on trigger and re-arms
`STALL` (240s, above the content script's 90s + one retry ceiling) on every progress tick; the saved-view loader ticks every second while batches are out, so its longer 5 min cap never trips it.
`ia_busy`/`ia_progress` carry a monotonic `seq` so the panel drops out-of-order pushes.

**Anaplan endpoints.** Only three, all using the existing session cookie: the springboard platform
gateway's model list (`/a/springboard-platform-gateway-service/customer/…/models?limit=50000`, the
list behind Anaplan's Models menu - Workspace's All Workspaces tab), the
springboard definition service (`/a/springboard-definition-service/customer/…/pages`, and `/boards|reports|grid-pages/<guid>`
per page) and `/jsonrpc` with `requestType: VIEW_REQUEST_SET` for saved-view definitions (and, for Workspace, model summaries;
for Revisions, the read-only `GET_MODEL_REVISIONS` system action), batched
10 views at a time (`IA_VB`), 4 batches in flight (`IA_VW`). `IA_pool()` caps concurrency at 8 for
page definitions. Opening a saved view makes Anaplan evaluate its filters, and a few views on large
modules cost a minute or more however little is requested — small parallel batches keep the cheap
views flowing past them. View batches get a 5 min cap (`IA_VTMO`) rather than the usual 90s, are
never retried, and a timeout stops new batches: Anaplan keeps working on an aborted request, so
aborting or retrying only adds server load and leaves the model busy after the client has given up.
No other server is ever contacted.

## Editing constraints

- **Four of the view renderers have no source in this repository.** `chunks/<page>-<hash>.js`
  are committed Svelte build output (actions, action_usages, pages, sv_filter_items).
  You cannot meaningfully edit them. Styling changes for those pages go in `views.css`, which is
  loaded after the compiled Tailwind CSS specifically to override it.
- `workspace`, `filter_items`, `sv_views`, `sv_line_items`, `sv_screens`, `sv_actions`, `process_steps`,
  `modules`, `line_items` and `lists` are hand-written ES modules over `chunks/sv_shared.js`. `filter_items` replaced a compiled view (kept as
  `chunks/filter_items-RDu0uzD1.js.retired`, which `package.sh` excludes) so filters could show each
  line item beside its condition and formatting rules their colours; it uses `renderPage`'s `tabs`
  option. Its rows carry `conditions` (and still `lineItems`) and `pegs` from `S()`/`T()` in `inner.js`. `sv_shared.js` deliberately re-implements the CSV writer and the fuzzy
  search scorer from `chunks/Empty-*.js` rather than importing them — that chunk's exports are
  minified single letters that would resolve to different functions if the bundle were ever
  rebuilt. Keep the two implementations in step; all fifteen views are expected to export and search
  identically. `renderPage`'s `max` option draws only that many rows with a "Show more" button
  (search and CSV still cover every row) - the Structure reports run to tens of thousands of rows.
  Every table sorts by clicking a column header (ascending, descending, back to original order).
  In `renderPage` the sort applies to the matches before the row cap and to Export to CSV; a
  header's `sort: row => value` gives the value (needed for numbers shown as text like "1.2 GB",
  and for big tables, since the fallback reads each cell's text). The four compiled views get it
  from `chunks/table_sort.js` (loaded in their HTML), which reorders rows with CSS `order` on a
  flex column - never moving Svelte's nodes - and re-applies through a MutationObserver.
- **Structure** is a panel group of three reports read off the in-page model cache by
  `IA_structure()` in `main.js`: `modules` (`IA_gmod`), `line_items` (`IA_gli`) and `lists`
  (`IA_glst`, Lists and Properties tabs), sharing `chunks/structure_shared.js`. That detail
  (formulas especially) is megabytes on a large model, so `main.js` only builds it when asked with
  `REQUEST_ANAPLAN_DATA {IA_want:"structure"}` - `P(0, "structure")` in `inner.js`, which keeps
  waiting if a reply meant for another concurrent gather arrives without `IA_struct`. Anaplan's
  cache shape for per-object detail is **not confirmed against a live model**: every field
  is probed under several likely key names (`IA_pick`) and left empty when none matches.
  Confirmed on a live model (a console dump): line item info holds `format` (`dataType`, …),
  `formula`, `fullAppliesTo` (array of list ids), `isSummary` and `leafPeriodType.entityLabel`
  (time scale; "Not Applicable" when unset) - there is no summary-method field. `fullAppliesTo` also
  carries Time (`20000000003`) and Versions, which Anaplan's Applies To column leaves out (they have
  columns of their own): ids the name index can't resolve are dropped when shorter than 12 digits
  (lists and subsets are 12), and a module's own `appliesTo` is read before its `fullAppliesTo`. A list's info holds
  `parentHierarchyEntityLongId` (`-1` = none), `itemCount`, and `propertiesLabelPage` +
  `propertiesInfo` (`{format, formula}` per property, same order). That label page's arrays are
  **flat** (`labels: [...]`), unlike every other label page (`[[...]]`); `IA_page` reads both. Names and
  IDs come from the label pages the other reports already rely on, so those are solid.
  `IA_shape` carries the keys the cache actually held, and a view with an empty column says so
  with those keys in its note and a "Show the fields Anaplan provided" disclosure
  (`fieldsBlock`) - that list is what to use to fix a probe. Confirmed on a live model: list
  names, IDs, parents (`-1` = none) and item counts. Properties were **not** where first guessed
  (a `propertiesLabelPage` per list), so `IA_listProps`/`IA_topProps` now find them by shape: any
  key matching `/propert/i` on a list's info or at the top of the model cache that holds a label
  page (or labelled objects), with a model-wide one split by a parallel list-id array. Line Items and Lists
  make no Anaplan calls; Modules also reads the `/pages` list (as Linked Pages does) for the App
  pages each module feeds, and still reports modules if that call fails.
- **Process Steps** (`process_steps`, Actions group, `IA_gps`/`IA_procSteps`) reuses
  `IA_actionDefs(ctx, true)`, which then keeps every cell of the process and export rows
  (`IA_cells`; the Actions views' cache stays small). Which `PROCESS_PROPERTY` column lists a
  process's actions is not documented either: the row's cells are read in order and the first one
  naming known action ids (or, failing that, exact action names) is the step list. A process
  whose steps can't be found gets a "No actions found" row and is counted in the page note. Its
  "Copy API call" buttons copy an Integration API v2 `curl` (`/processes|imports|exports|actions/
  <id>/tasks`) for the user to run with their own token - the extension itself never calls
  `api.anaplan.com` and never runs anything.
- **Revisions** (`revisions`, `IA_grev`, `chunks/revisions.js`) is one `/jsonrpc` call with no view
  requests and `systemActions: [{actionId: "GET_MODEL_REVISIONS", params: {modelId, workspaceId}}]`,
  as Anaplan's own Revision tags page sends it; the tags are in `result.systemActionResults[].revisions`
  (title, description, created by/on/in, `revisionTargetModels` = the models it was applied to and
  how). "Synced" mirrors that page's icon: this model is a target by sync/import/copy rather than
  "User added revision". "Current": the tag's `metadataId` equals the reply's, i.e. the model's
  definition is unchanged since. Two tabs - Revision Tags and Applied To.
- **Workspace** is a panel group of two reports sharing `chunks/workspace_shared.js`:
  `workspace` (Current - `chunks/workspace.js`, gathered by `IA_gws()`) lists the current
  workspace's models (Active / Archived / Deleted tabs - a deleted model keeps its row, state
  `DELETED` with a purge date, until purged; like archived ones it doesn't count toward storage) under an in-use-vs-allowance meter (`renderPage`'s `top`
  option); `workspace_all` (All - `chunks/workspace_all.js`, `IA_gwsa()`) has a Workspaces tab (storage
  per workspace + totals) and a Models tab (every active model, with its workspace). They are separate
  gathers because a workspace on another server can take minutes and Current must not wait on it.
  "In use" is `contractualWorkspaceSize` - what Anaplan's Model Management dialog shows, the sum of
  non-archived models' sizes - **not** `workspaceSize`. Each workspace is one `/jsonrpc` call shaped
  like Anaplan's own Workspace Summary page: `workspaceId`, **no `modelId`**,
  `fetchAllModelSummaries:true`, so `modelInfo` comes back null instead of the whole model
  definition. All finds the workspaces through the platform gateway's model list and calls them **one
  at a time** (4 in parallel failed where the same calls in sequence succeeded), each one attempt
  capped at `IA_VTMO` with a 1s progress ticker (no retry - see the saved-view loader). A workspace
  hosted on another server answers this frame's jsonrpc with only `{redirectUrl:
  "https://…/coreNNNN/anaplan/framework.jsp?…"}`; `IA_wsInfo` re-sends once to the jsonrpc beside that
  framework.jsp (https `*.anaplan.com` only). Cores move weekly - never store one. A workspace whose
  call still fails falls back to its rows from the model list (no sizes) and the view names it with
  the reason.
- `summary` (`chunks/summary.js`) is the sixteenth view and the odd one out: no CSV or search, gathered
  automatically when the panel opens (it makes no Anaplan calls), and it asks the worker for
  `ia_overview` to show which reports are cached. Its `REPORTS` list mirrors `VIEWS` in
  `sidepanel.js` — keep the two in step. Its **Download all as CSV (.zip)** button
  (`chunks/export_all.js`) asks the worker for every cached payload (`ia_dump`) and zips one CSV
  per view tab plus `summary.csv`, built entirely in the page (a small ZIP writer, raw DEFLATE via
  `CompressionStream`). The hand-written views are imported with `globalThis.IA_COLLECT` set, which
  makes `renderPage` register their options instead of drawing, so their CSV columns are defined
  once; the four compiled views' columns are mirrored in `COMPILED` there - keep those in step.
  Beside it, **Get all data** asks the panel (`window.postMessage` `ia_getall` / `ia_getall_stop`)
  to gather every report not yet loaded **one after another** (`getAll`/`pump` in `sidepanel.js`:
  `IA_step`'s progress page is one global per frame, and parallel gathers would also all load the
  model at once). The queue moves on when the running report stops being busy, ignores the
  `ia_select` each gather sends so the panel stays on Summary, reports back with
  `ia_getall_status`, and is dropped by Stop and by a model switch. It and the Actions tab counts
  (`chunks/actions_counts.js`) are styled with `ia-*` classes in `views.css`, because the compiled
  Tailwind CSS only contains utilities the bundled views already use.
- **`background.js`, `inner.js`, `outer.js` and `main.js` are minified vendor output with
  hand-written additions merged in.** Identifiers added by this project are prefixed `IA_`
  (`IA_pool`, `IA_step`, `IA_views`, `IA_screenViews`, …) to keep them clear of the single-letter
  minified names — follow that convention, and never reuse a bare single letter at module scope.
  The multi-line `/* … */` comments in these files explain past bugs; preserve them.
- Adding a view means touching all of: `PAGES` in `background.js`, `VIEWS` in `sidepanel.js`, the
  trigger map in `inner.js` (`p()`), a new `<page>.html`, a renderer, `package.sh`, and `REPORTS`
  in `chunks/summary.js`.
- **SV Filters (`sv_filter_items`) and SV Items (`sv_line_items`) are switched off** — shown greyed
  out and tagged *Slow*, because opening every saved view makes Anaplan evaluate its filters (tens of
  minutes on a large model). Their gathers and renderers are intact; the switch is `off` in `VIEWS`
  (`sidepanel.js`), `off` in `REPORTS` (`chunks/summary.js`) and `OFF` in `background.js`, which
  refuses `ia_load`/`ia_refresh` for them. The `⌘⌥K` shortcut that started SV Filters is removed
  from `outer.js`/`inner.js`. Re-enabling means undoing all of those.
- `popup.html` and `chunks/popup-*.js` are dead — the manifest has no `default_popup` and
  `package.sh` excludes them.

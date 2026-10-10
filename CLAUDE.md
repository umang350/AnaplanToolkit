# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 extension ("Anaplan Toolkit"), shipped for both Chrome and Firefox, that reports on
the structure of the Anaplan model open in the active tab. Seventeen read-only report views, each
gathered on demand, cached, and exportable to CSV, plus a Summary view the panel opens on - and two
views that change the model, Delete Line Items and Delete Modules (see below). Proprietary internal tool — see `LICENSE.txt` and
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

`dist/`, `dist-firefox/` and the two zips are git-ignored build output; `package.sh` deletes and
regenerates all four. `package.sh` maintains an explicit allowlist of top-level files — **a new
top-level HTML/JS/CSS file must be added to that list**; the script hard-fails on a file that is
listed but absent *and* on a top-level `*.html`/`*.js`/`*.css` that is present but unlisted.

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
  `background.scripts`, but AMO's validator warns on the unsupported key's presence). The Chrome
  build gets the mirror image: `dist/manifest.json` drops `sidebar_action` and `background.scripts`,
  which Chrome lists as warnings on its extensions page. Loading the repository root unpacked still
  shows those two warnings - harmless, but load `dist/` to avoid them.
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
  api.js                ISOLATED world, top frame of any Anaplan tab — Lock Monitor's API relay
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
The one write is Delete Line Items' `/jsonrpc` call, whose `submissions` carry `DeleteLineItem` model
changes (see below); every other call only reads.
Beyond those, only the Lock Monitor calls Anaplan's Integration API (`api.anaplan.com`, model
status, with the page's cookies). No non-Anaplan server is ever contacted.

## Editing constraints

- **Three of the view renderers have no source in this repository.** `chunks/<page>-<hash>.js`
  are committed Svelte build output (action_usages, pages, sv_filter_items).
  You cannot meaningfully edit them. Styling changes for those pages go in `views.css`, which is
  loaded after the compiled Tailwind CSS specifically to override it.
  One hand patch: in the shared Svelte runtime `chunks/style-Xzc7Y0WM.js`, the template function
  (`Xr`) builds its fragment with `DOMParser` instead of `template.innerHTML`, because AMO's validator
  flags that `innerHTML` as unsafe. Same nodes either way (checked on every template the views use).
  Re-apply it if those chunks are ever rebuilt.
- `actions`, `workspace`, `filter_items`, `sv_views`, `sv_line_items`, `sv_screens`, `sv_actions`, `process_steps`,
  `modules`, `line_items`, `lists`, `revisions`, `lock_monitor` and `page_line_items` are hand-written ES modules over `chunks/sv_shared.js`. `filter_items` replaced a compiled view so filters could show each
  line item beside its condition and formatting rules their colours; it uses `renderPage`'s `tabs`
  option. `actions` replaced the compiled Actions view
  because that drew every row of every list, each with a copy-button component, on its All tab and on
  every keystroke, hanging the browser on large models; it keeps the old tabs (All first), CSV files and
  columns, shows each tab's total on the tab bar (`renderPage`'s `counts`, replacing
  `chunks/actions_counts.js`) and leaves its All tab out of Download all (`zip: false`). Filters' rows carry `conditions` (and still `lineItems`) and `pegs` from `S()`/`T()` in `inner.js`. Anaplan keeps a
  formatting rule (and a column width) after its line item is hidden from the grid, so `IA_onGrid`
  reads the widget's line item axis (dimension `20000000012`: `shows`, or `hides` when `shows` is
  empty) and a rule whose target is off the grid gets `onGrid: false` - tagged "Hidden on grid", not
  dropped (confirmed on a live model). A line item in `shows` whose axis carries a filter gets `onGrid` = the
  filter line items' names, tagged "Filtered: …": whether it shows depends on data, often per user
  (confirmed live: a boolean by Users x a line item subset), so the report doesn't guess. Line Items on Pages uses it too: such a target counts as
  Hidden, and that rule's source isn't counted at all. `sv_shared.js` deliberately re-implements the CSV writer and the fuzzy
  search scorer from `chunks/Empty-*.js` rather than importing them — that chunk's exports are
  minified single letters that would resolve to different functions if the bundle were ever
  rebuilt. Keep the two implementations in step; all eighteen views are expected to export and search
  identically. `renderPage`'s `max` option draws only that many rows with a "Show more" button
  (search and CSV still cover every row) - the Structure reports run to tens of thousands of rows.
  Without it a tab gets `DEFAULT_MAX` (400): drawing all 8,000 Filters rows on every keystroke and
  sort hung the browser. Search waits for a 150ms pause in typing, and each tab's rows and search
  keys are worked out once per payload.
  Every table sorts by clicking a column header (ascending, descending, back to original order).
  In `renderPage` the sort applies to the matches before the row cap and to Export to CSV; a
  header's `sort: row => value` gives the value (needed for numbers shown as text like "1.2 GB",
  and for big tables, since the fallback reads each cell's text). The three compiled views get it
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
  (lists and subsets are 12), and a module's own `appliesTo` is read before its `fullAppliesTo`.
  A module's info also holds `leafPeriodType` (Time Scale), `timeRangeLabel` and `versionSelection`
  (`IA_modTime`): the Modules view shows Time Scale and Time Range columns, Versions is CSV only.
  `timeRangeLabel` is "Time" where Anaplan's grid says "Model Calendar", and only counts when the
  module has a time scale - otherwise the grid says "Not Applicable". That mapping is inferred
  from the grid, not confirmed field by field. A list's info holds
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
- **Line Items on Pages** (`page_line_items`, Pages group, `IA_gpli`/`IA_pliBuild`) scans only the
  pages picked on its start screen. The panel's picker (`#empty-pg`, `paintPicker` in `sidepanel.js`)
  asks the worker for `ia_pg_list`, which `tabs.sendMessage`es the report engine (`IA_pgList`: one
  `/pages` call). The answer comes back as `ia_pg_list_result` runtime messages (`started`, then
  `result`; the worker's `pgWaits`), **not** `sendResponse`: the request reaches every frame, and a
  frame without the listener (api.js, outer.js) closes the channel unanswered before the model
  frame's reply arrives - the first build used sendResponse and the picker always said the tab did
  not answer. No `started` within `PG_START` (8s) means no report engine in the tab. The panel shows the pages grouped by app, then category (`IA_pgCat`
  probes a few key names - **not confirmed** which one Anaplan uses). Ticks and the saved-views option
  are remembered per model in the panel's localStorage `ia_pli:<key>`, and `ia_load` carries
  `pages` + `sv` through to the trigger (`n(e.force, e)` in `p()`). There is no cache probe (the
  cached report is for whichever pages were picked last), it is `pick` in `VIEWS`/`REPORTS` (left
  out of Get all data and the loaded count), and its refresh button - and the view's "Choose other
  pages" (`ia_pli_pick` to the panel) - reopen the picker rather than re-run. Widget definitions are
  undocumented and differ per widget type, so `IA_pliWalk` walks each definition whole, reports every
  id that is a line item of the model, and names the placement from the key path to it
  (`IA_pliWhere`: hidden > filter > formatting > sort > columns > rows > page/context > chart >
  "Shown"); `paths` in the report lists the key paths that matched, which is what to check this
  against on a live model. A widget naming a module but no line item gets that module's line items
  as "All (module default)" (minus any found under a hidden key). A widget on a saved view takes the
  view's explicit line item selection per axis (`IA_pliAxes`) when the option is on - that loads only
  the views behind the picked pages, through `IA_views`.
- **Process Steps** (`process_steps`, Actions group, `IA_gps`/`IA_procSteps`) reuses
  `IA_actionDefs(ctx, true)`, which then keeps every cell of the process and export rows
  (`IA_cells`; the Actions views' cache stays small). Which `PROCESS_PROPERTY` column lists a
  process's actions is not documented either: the row's cells are read in order and the first one
  naming known action ids (or, failing that, exact action names) is the step list. A process
  whose steps can't be found gets a "No actions found" row and is counted in the page note. Its
  "Copy API call" buttons copy an Integration API v2 `curl` (`/processes|imports|exports|actions/
  <id>/tasks`) for the user to run with their own token - the extension never runs anything (its only
  `api.anaplan.com` call is the Lock Monitor's read-only model status).
- **Revisions** (`revisions`, `IA_grev`, `chunks/revisions.js`) is one `/jsonrpc` call with no view
  requests and `systemActions: [{actionId: "GET_MODEL_REVISIONS", params: {modelId, workspaceId}}]`,
  as Anaplan's own Revision tags page sends it; the tags are in `result.systemActionResults[].revisions`
  (title, description, created by/on/in, `revisionTargetModels` = the models it was applied to and
  how). "Synced" mirrors that page's icon: this model is a target by sync/import/copy rather than
  "User added revision". "Current": the tag's `metadataId` equals the reply's, i.e. the model's
  definition is unchanged since. Two tabs - Revision Tags and Applied To.
- **Lock Monitor** (`lock_monitor`, `chunks/lock_monitor.js`) is the one report that runs until
  stopped, and is driven **from the worker** (`lkStart`/`lkLoop`/`lkProbe` in `background.js`), not
  from the report engine: a busy model is exactly when the model page may never load. Workspace and
  model IDs come from the tab URL (`lkIds`). Once a second, never two at once, it reads the
  Integration API's model status, **`GET`** `https://api.anaplan.com/2/0/workspaces/{w}/models/{m}/status`
  (confirmed live: POST answers 415/405). The reply is `{requestStatus: {currentStep, progress,
  tooltip, taskId, creationTime, exportTaskType, peakMemoryUsage*}}`: `currentStep` "Open." when idle,
  "Processing ..." with e.g. tooltip "The system is currently processing an Export: … started by … at
  06:59 (UTC)" when busy. HTTP 423/424 = locked/offline.
  **The API refuses extension origins** (confirmed with a valid token: `Origin: chrome-extension://` or
  `moz-extension://` -> empty 403; `Origin: https://us1a.app.anaplan.com` -> 200; its preflight allows
  GET + `Authorization` + credentials from any Anaplan page origin). So every API call goes through
  `content-scripts/api.js` in the tab's top frame (`lkFetch` -> `ia_lk_fetch`, `frameId: 0`; Stop sends
  `ia_lk_abort`), which only does GETs to `api.anaplan.com/2/0/` for the extension itself, using
  `content.fetch` on Firefox so the request is the page's. It runs at `document_start` in the Anaplan
  shell, which is up even while the model is busy. A missing or bad token is **401** (checked).
  Two page-reading attempts failed live and were removed: Workspace's summary call said Unlocked while
  busy, and the "Model is busy" banner needs the page up and dropped back to Available while shown.
  **Session first (`lkRpc`):** before the API, each run tries the call Anaplan's own client uses to
  show "Model is busy" (read off a live HAR): jsonrpc `requestType: "REQUEST_STATUS"`
  (`{requestSerialNumber: "<GUID>-<n>", requestStatusRequestCount, workspaceId, modelId}`) POSTed to
  the model's core, `…/coreNNNN/anaplan/jsonrpc`, via `api.js` (`ia_lk_rpc`; the top frame is
  same-origin with the core, so the session cookie goes and no token is needed). The reply is
  `{requestStatus: {currentStep "Open" | "Updating" | "Processing ...", tooltip "…processing change(s)
  by user … Submitted at 08:10 (UTC)", taskId = the serial asked about, …}}`. `api.js` finds the core
  from the framework.jsp frame or the page's resource timings and follows a wrong core's
  `redirectUrl`; it relays nothing but REQUEST_STATUS. Anaplan's client only asks about its *own*
  pending request (2s after sending it, then every ~5s) - whether the server reports the model's real
  state for our own serial is **not confirmed**. A run whose first REQUEST_STATUS has no
  `requestStatus` moves to the API for good (`run.mode`, `run.rpcWhy` saved in the report).
  **API login:** the API does **not** honour the session (confirmed: from the page it gets only
  Cloudflare/consent cookies -> 401; region URLs `us1a.app.anaplan.com/2/0/…` answer 503 "deprecated");
  on 401/403 the run stops with `ia_page_error` saying so. There is **no token or password login** -
  a pasted AnaplanAuthToken and a user ID + password sign-in (via `auth.anaplan.com`) were built and
  then removed on purpose, so the extension never handles credentials. Don't add them back.
  Confirmed live: the session path works and shows every user's work ("Busy" with "processing
  change(s) by user …", "Updating" for a change being saved - its own status, lighter amber).
  **Per run** (panel `#empty-lk`, remembered in the panel's localStorage `ia_lk_opts`, sent with
  `ia_load`): interval `every` from `LK_EVERIES` (1s-1min) and length `hours` from `LK_HOURS`
  (15 min-12h); anything else falls back to `LK_EVERY`/`LK_MAX`. **Live report:** the loop pushes a
  snapshot (`lock_monitor_data`, `data.live: true`) every `max(5s, n×20ms)` - the one unsolicited
  data push, fine because the panel keeps the view's iframe up while the run is busy and the next
  push replaces a lost one; `renderPage` keeps scroll, shown rows and search focus across live
  updates, and the panel shows the progress as a strip (`compact`) over a live view. **Saved as it
  goes:** `cacheSet` every `max(10s, n×10ms)` with `why: "running"`, so a worker restart mid-run
  leaves the checks so far (the view calls it interrupted). **Notifications** are opt-in: the
  checkbox requests the *optional* `notifications` permission; with it the worker notifies once a
  model has been unavailable `LK_NOTE_BUSY` (30s) and when it is free again after `LK_NOTE_FREE`
  (10s). The view shows Anaplan's "(UTC)" times in local time (`localTip`; CSV keeps
  `TooltipAsSent`). The view has no explanatory note or fields disclosure (removed on request);
  the cached report still records the method (`login`) and the reply's keys (`keys`) for debugging.
  **Refresh continues, Clear starts over:** `ia_refresh` (the panel's refresh button, "Continue
  monitoring") seeds the run with the saved report's checks (`lkLoop(…, prev)`) and marks its first new
  check `gap`; the view draws the time between as a `Paused` period (thin dashed slice in the strip,
  left out of the shares and "longest unavailable"). `ia_load` (Start, from the empty screen) begins a
  new run. The view's **Clear report** button (two clicks) sends `ia_clear`; the worker drops the cache
  (refused while running) and pushes `ia_state` with `ts: 0`, on which the panel removes the frame and
  shows the start screen with its options. A continued run's length and first-check rules count from
  its own start (`runAt`, `fresh`).
  Stop is how it ends: `ia_cancel` stops the run (waking it from its interval wait) and the worker
  caches what it gathered (`LIVE`) where other stopped runs are dropped. The panel's `stop()` keeps a
  live view's report up (no `fail()`) until that saved copy arrives; a run stopped before its first
  check answers with `ia_page_error`. `modelKey` never caches the page's `""` (what a busy model gives
  after 3s): it falls back to the key in the new UX URL (`lkIds`), the same `<customer>:<model>` the
  page gives - an empty key once made a just-saved run read as "no longer cached". It also ends after its
  length, about two minutes of failed checks in a row, or a refused login mid-run. `live` in `VIEWS` / `REPORTS` keeps it out of Get all data and the loaded
  count.
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
  All is `solo` in `VIEWS` / `REPORTS`: it calls every workspace the user can access, so it is left
  out of Get all data and the loaded count (Current is still gathered) and runs only when opened.
- **Delete Line Items** (`delete_line_items`, Structure group, `IA_gdl` in `inner.js`,
  `chunks/delete_line_items.js`) is the one view that **changes the model**. The panel's start screen
  (`#empty-dl`, `dlRead`/`csvParse` in `sidepanel.js`) reads a CSV, finding the Module, Line Item and
  (optional) Line Item ID columns by header name - the Line Items report's own export works as is -
  and keeps nothing but those (not stored). Check (`ia_load`, `mode: "check"`) changes nothing: it
  reads the model's structure **from Anaplan** (`IA_dlRead`: `/jsonrpc`, no view requests,
  `modelDefinitionSerialNumber: -1`, whose reply carries `modelInfo` - not the in-page cache, which can
  lag the server) and marks each row ready only when its ID is a line item of this model, in the
  module named, with the name given (case and spacing ignored); a row without an ID matches by module
  + name. Anything else is skipped with the reason. The report then asks before deleting: the number
  of line items must be typed. It posts `ia_dl_delete` (the ready rows and the model ID) to the panel,
  which sends `ia_refresh` with `mode: "delete"`; `IA_gdl` refuses a model other than the checked one
  (line item IDs are numbered per model) and matches every row again before deleting. The delete is
  what Anaplan's own *Delete from Line Items* dialog sends (read off a live HAR): `VIEW_REQUEST_SET`
  with `submissions: [{workspaceId, cellChanges: [], modelChanges: [{modelId, modelChangeXml:
  '<ModelDefinition><DeleteLineItem entityLongId="…"/></ModelDefinition>'}, …]}]` and the
  `modelDefinitionSerialNumber` the previous reply gave (the dialog's own `viewRequests` only refresh
  the grids open on screen, so they are left out). **A change needs the page's session** (confirmed live: without it
  Anaplan answers `{error: "The server did not recognise the request as originating from a page it
  had recently delivered to you…"}` and applies nothing; reads don't need it): the body carries
  `clientSessionId` (the page's 32-hex id, which also prefixes Anaplan's `Request-Serial-Number`
  header) and `txid` (the previous reply's `txid` - they chain), with headers `X-Requested-With:
  XMLHttpRequest` and `X-Client-Session-Id` (the frame URL's own `clientSessionId` parameter, a short
  different id). `main.js` finds the 32-hex id (`IA_findSess`, asked with `IA_want: "session"`): from
  the page's own outgoing jsonrpc bodies (`IA_hookSess` wraps XHR `send`/`fetch` to look - never to
  change them), else under a key named like clientSessionId in `window`/`window.anaplan`; with
  neither, the delete refuses before calling. `Request-Serial-Number` itself is **not** sent - a
  number from the page's sequence could collide with its next request. **Order and batching** (confirmed live):
  Anaplan applies one request's changes in order and all or nothing, and refuses a line item still
  used by another - even one later in the same request ("Revenue cannot be deleted because it is in
  use: Margin = …" with Margin further down); a refusal leaves the serial unchanged and carries no
  `modelInfo`, so nothing is re-read after one. The order is **planned from the formulas**
  (`IA_dlUsers`/`IA_dlPlan`): `modelInfo.moduleInfos[].lineItemInfos[].formula` (aligned with the line
  item label page) is scanned for `'Module'.Line Item` / `Module.Line Item` references (longest name
  first; string literals blanked) and bare names of the formula's own module (not after a `.`, so
  list-qualified names don't count). Check marks a row `inuse` when a line item outside the CSV uses it
  (or uses one that does) - left alone unless the confirmation's "Also try" box sends `tryInUse`.
  **Whole modules:** a module whose every line item is in the CSV and ready (none `inuse`) is *whole*
  (`whole` on its rows, `wholeModules` on the report, a Modules tab). An optional **Module ID** column
  (`moduleId`, which the Line Items report exports) must name the module given. With the confirmation's
  box ticked (`wholeModules`), each whole module goes as a **module delete, one module per request**
  (Anaplan allows only one), in plan order, when no line item this run hasn't deleted yet uses it; a
  refusal sends its line items the usual way, and a whole module whose line items all went that way is
  deleted (now empty) at the end. The request's XML comes from `IA_DL_MOD(moduleId)`:
  `<ModelDefinition><DeleteModule entityLongId="…"/></ModelDefinition>`, read off a live HAR of Anaplan's
  own module delete (same body and reply shape as a line item delete; the modules were gone from the
  reply's `modelInfo`; its dialog sent two modules in one request and both went). **A line item whose format is No Data is no use of anything** (`noData` on the index, from `lineItemInfos[].format.dataType` `NONE` - not confirmed that the jsonrpc reply carries it; absent, nothing changes): `IA_dlUsers` doesn't read its formula. Confirmed against a live cleanup (History: 42 line items deleted in one request while the No Data line items using them stayed; every user Anaplan refused had a Number, Boolean or Text format). **Run log:** both delete engines keep `log` (on every `ia_live` snapshot and the final result): one entry per request - `at`, `ms`, `kind` (line items / module), `items`, `what`, `result` (applied / refused / error), `why` (Anaplan's reason), `serial` / `serialAfter` - plus reads of the model and pauses. The views' **Export log** button and the auto-save write it as a second CSV beside the report (`…-log.csv`, `runLogRows` in `sv_shared.js`), and the status line adds the time Anaplan took and the slowest call. **Processes (read at Check, `IA_dlProcBlocks`):** a module whose import or export a process runs can't be deleted (Anaplan: "'IMP_x' cannot be deleted because it is referenced by Process 'PRS_y'"), so Check reads processes → their actions → the modules those use (an import's **target**, and a module id in an export's row cells - not an import's source or line item ids: matching those listed 17 processes that were never in the way, against the 6 a live cleanup needed; **which export cell names the module is not confirmed**) and lists the processes it finds (`procMods`) - checked against a live cleanup: all 15 it listed were real blockers (6 whose modules Main deleted after deleting the processes, 9 whose modules Main left, emptied; 519 whole modules - 510 deleted modules = those 9). It is **advisory: nothing is taken out of the run** - every whole module is attempted, and the one Anaplan refuses (a refusal that names the process exactly) is kept, listed in Skipped as "Module kept" and its process under "Delete these processes first", while its **line items are deleted one by one**. Whether to delete a listed process is the user's call: deleting it lets its module go, leaving it keeps the module (emptied). **Order of a run with whole modules ticked** (tested offline against a simulated server on the 11,197-line-item / 519-module cleanup: 575 requests, no refusal; before, 850 with 294): line items are first put in order one by one (each after the line items that use it - module order alone is refused where two modules use each other's line items); then 1) the line items outside whole modules that no whole-module line item uses, directly or through others; 2) the whole modules, one per request, a module before those it uses - a module still used by a pending line item is freed by deleting those users (and what uses them, its own line items included) just ahead of it, which is how a cycle between modules is broken; a refusal that names a line item whose users the formulas show is cleared and retried once, a refusal that says it is `referenced by` a process (import, export, action) keeps only the module - its line items are deleted one by one in the last passes - and any other refusal (a saved view the formulas don't show) **leaves the module whole with its line items** (`keep`, shown as Not deleted with the reason) instead of dissolving into line items; 3) whatever was deferred, minus line items used by a kept module. When a line item is refused, what it uses is set aside with it rather than sent and refused one at a time. Setting it to `null`
  switches whole-module deletes off: the report still shows the whole modules but their line items are
  deleted instead (`mods[].status: off`). A refused module delete (live HAR) names the **line item** in use, like a
  line item refusal ("'SYS00 Time Settings'.Last day of Month cannot be deleted because it is in use: …"), with
  no `modelInfo` and `modelDefinitionSerialNumber: 0` - so a serial of 0 or less is taken as none (never kept)
  and an error with it is a refusal; the module's line items then go the usual way.
  The rest go **whole modules, several to a request** (up to `IA_DL_BATCH` = 200 line items; a bigger
  module goes alone - every applied request returns the whole model, seconds each on a large model, so one
  request per module made an 841-module run take hours): a module before the modules whose line
  items it uses, and inside a request a line item before the ones it uses (ties bottom-up, last module
  first). Modules that use each other in both directions can't both be whole: before each request the
  line items still used by a line item this run deletes later are held back (`hold`, repeated until
  nothing changes) for a later pass. A refusal (a use no formula shows, e.g. a saved view filter) sets
  aside the line item Anaplan names (`IA_dlBlocker`) and resends the rest - when it can't be told which, the
  request is halved (a refusal is small and fast); set-aside line items are
  retried in later passes while something has been deleted since (`seen`). A quoted name is one token (it counts only when the whole of it is a line item of the module), a name followed by `(` is a function (`CODE(...)`), and a match touching another word (spaces only between, operator words aside; `by` is not one - list names hold it) is part of a longer name, **a `Module.Line Item` reference whose module name has spaces is unquoted - the qualifier is found by looking back from each dot for a module's name (most cross-module references; before this was added the scanner saw none of them, and a live run was refused 31 of its first 39 calls)**, a quoted name writes its own apostrophe doubled (`'DAT_PlanningYear Ssn_User''s Select'.'…'`), an unquoted name holds no operator or bracket (so the text `a * b` is two line items, not one called "a * b"), a quoted name followed by a dot, and the argument of `ITEM(` / first of `FINDITEM(`, are lists, not line items (confirmed: such line items were deleted from the model without their formulas changing), and a quoted name after a dot counts only when the qualifier is this module (another module's name with spaces isn't quoted) - without these, `'Item Color Size'` was a use of a line item called Color (confirmed on a live model's formulas: 1,229 false uses dropped). Tested offline on a
  generated 700-module, ~11,000-line-item model whose formulas are written from a known dependency
  graph: references read 10,558/10,558, in-use flagged exactly, ~1,070 requests with only the hidden
  uses refused; and the 12 real refusals from live runs all come out in the right order. **Memory:** an
  applied delete moves the serial on, so its reply carries the whole `modelInfo` (tens of MB on a large
  model); parsing and re-indexing that per request ran Chrome out of memory (~19 GB after ~80 deletes).
  Delete replies are therefore read as a stream (`IA_dlScan`), keeping only `result.modelDefinitionSerialNumber`,
  `txid`, `errorInfo` and a top-level `error`: no error + new serial = every line item in it is gone (all or
  nothing), tracked in the run's `gone` set; anything else falls back to a full `IA_dlRead`. Full reads happen
  only at the start, the end and in that fallback. **Live snapshots** (`ia_live`) carry every row, so at most one per `max(2s, rows/5 ms)`; the worker's `push`
  sends one copy at a time (it used to re-send every 10ms until a send settled, so a 10,909-row report went
  out several times per update to every panel frame and the extension's process died past 2 GB). **Orphaned runs stop:** reloading the extension cuts the
  tab's script off from Stop/Pause, so before each request `IA_alive()` (`runtime.id`) is checked and the
  run ends if it is gone (no final read). Nothing is resent blindly. A
  timeout or network failure stops the run (the request may still complete on Anaplan's side); Stop
  takes effect between requests and never aborts one in flight (its fetch is not in `IA_ctl`). After
  each request the engine sends `ia_live` (the report so far: rows `queued` / `deleted` / `failed`,
  `running: true`), which the worker pushes as `delete_line_items_data` with `live: true` while the
  run is busy, so the report fills in as it goes. **Pause / Resume** (the report's button; `ia_dl_pause`
  view -> panel -> worker -> every frame of the tab, `IA_dlPaused` in `inner.js`): the run waits before
  its next request - one already sent is never cut short - ticking a "Paused" step every second so the
  worker's `STALL` watchdog stays quiet; Stop still ends it. The pause message makes the engine send a snapshot at once (`IA_dlLive`), so the report shows "Pausing" while a request is out and "Paused" after it; snapshots also carry `flight` (`IA_dlFlight`: the request's start time, sent once it passes 10s) which the view counts locally and flags as slow after a minute (`runPause`/`runWait` in `sv_shared.js`, shared with Delete Modules). Snapshots carry `paused` and `calls` (`{sent, applied, refused}` delete requests, shown in the report's status line; the final report keeps them). **Saving the
  report:** the confirmation's auto-save option sends `autosave` (minutes, 5-30) with the delete; the
  view (`autoSave` in `chunks/delete_line_items.js`) saves the report as a CSV in each new
  `autosave`-minute slot from the run's start (`at`) - a view opened mid-run waits for the next slot -
  and once when it ends (remembered per run in localStorage as `ia_dl_final:<at>`), plus a "Save report
  now" button while running. It uses the **optional `downloads` permission** (requested inside the Delete
  now click) to one file per run, `conflictAction: "overwrite"`, falling back to an ordinary download; it
  needs the panel open. The module skips this when Summary imports it (`IA_COLLECT`). Separately the
  worker keeps the latest snapshot in the cache at most once a minute (`dlKept`, `partial: true`), so a
  closed panel or a restarted worker still has the report so far; the view flags a `partial` report.
  A final read decides each row's status (deleted / failed). It is in `LIVE` in `background.js` so a
  stopped run's result is still cached, and once anything is deleted the worker drops `DL_STALE`
  (Line Items, Modules, Filters, Line Items on Pages) for that model. The Anaplan tab's own cache is
  stale until it is reloaded, which the report says. Confirmed live: the session fields above are
  enough (157 line items across 18 modules deleted without `Request-Serial-Number`), and a refusal
  arrives as `errorInfo.errorMessage` ("X cannot be deleted because it is in use: …") with the serial
  unchanged and no `modelInfo`. Not confirmed: which of `IA_findSess`'s two ways found the id. `upload` in `VIEWS` / `REPORTS` keeps it out of
  Get all data and the loaded count.
- **Delete Modules** (`delete_modules`, Structure group beside Delete Line Items, `IA_gdm` in `inner.js`,
  `chunks/delete_modules.js`) deletes **whole modules** from a CSV of **Module** and **Module ID** (the
  Modules report's export works as is; `dmRead`/`DM_COLS` in `sidepanel.js` - each upload tab keeps its own
  CSV in `ups`, and the start screen's hints are picked by `data-for`). It shares Delete Line Items' machinery:
  the same panel messages (`ia_dl_pick` / `ia_dl_delete` / `ia_dl_pause`, routed by which tab's frame sent
  them), the worker's `LIVE` / `ia_live` / `dlKept` / `DL_STALE` handling, and in `inner.js` `IA_dlRead`,
  `IA_dlRpc` (lean), `IA_dlUsers` and `IA_DL_MOD`. Check matches each row by ID (it must name the module
  given) or by name, and marks a module `inuse` when a line item in a module that isn't listed uses one of its
  line items - and, repeated, any listed module a kept module uses. Delete goes **one module per request**, a
  module before the modules it uses (ties: last module first); a refusal (serial 0 or unchanged, as in Delete
  Line Items) keeps the module, which is retried while others are deleted (`seen`) - nothing smaller is
  deleted in its place. A final read decides each row. The confirmation wants the number of modules typed.
- `summary` (`chunks/summary.js`) is the twentieth view and the odd one out: no CSV or search, gathered
  automatically when the panel opens (it makes no Anaplan calls), and it asks the worker for
  `ia_overview` to show which reports are cached. Its `REPORTS` list mirrors `VIEWS` in
  `sidepanel.js` — keep the two in step. Its **Download all as CSV (.zip)** button
  (`chunks/export_all.js`) asks the worker for every cached payload (`ia_dump`) and zips one CSV
  per view tab plus `summary.csv`, built entirely in the page (a small ZIP writer, raw DEFLATE via
  `CompressionStream`). The hand-written views are imported with `globalThis.IA_COLLECT` set, which
  makes `renderPage` register their options instead of drawing, so their CSV columns are defined
  once; the three compiled views' columns are mirrored in `COMPILED` there - keep those in step.
  Beside it, **Get all data** asks the panel (`window.postMessage` `ia_getall` / `ia_getall_stop`)
  to gather every report not yet loaded **one after another** (`getAll`/`pump` in `sidepanel.js`:
  `IA_step`'s progress page is one global per frame, and parallel gathers would also all load the
  model at once). The queue moves on when the running report stops being busy, ignores the
  `ia_select` each gather sends so the panel stays on Summary, reports back with
  `ia_getall_status`, and is dropped by Stop and by a model switch. It and the Actions view's columns, copy buttons
  and tab counts are styled with `ia-*` classes in `views.css`, because the compiled
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

# Anaplan Toolkit

<p>
  <a href="https://chromewebstore.google.com/detail/anaplan-toolkit/kbbgidpmmiechmccmmjpjkidihojdgnj"><img src=".github/badges/chrome-web-store.png" alt="Available in the Chrome Web Store" height="58"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/anaplan-toolkit/"><img src=".github/badges/firefox-addons.svg" alt="Get the add-on for Firefox" height="58"></a>
</p>

[![Chrome Web Store version](https://img.shields.io/chrome-web-store/v/kbbgidpmmiechmccmmjpjkidihojdgnj?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/anaplan-toolkit/kbbgidpmmiechmccmmjpjkidihojdgnj)
[![Firefox Add-ons version](https://img.shields.io/amo/v/anaplan-toolkit?logo=firefoxbrowser&logoColor=white&label=Firefox%20Add-ons)](https://addons.mozilla.org/en-US/firefox/addon/anaplan-toolkit/)
[![Latest GitHub release](https://img.shields.io/github/v/release/umang350/AnaplanToolkit?logo=github&label=Latest%20release)](https://github.com/umang350/AnaplanToolkit/releases/latest)

Chrome and Firefox extension for analysing Anaplan models. Not affiliated with, endorsed by, or
supported by Anaplan, Inc.

**Version:** 2.6.0
**Author:** Umang Chauhan
**Copyright:** © 2026 Umang Chauhan. All rights reserved.
**Licence:** Proprietary — see [LICENSE.txt](LICENSE.txt). You may install and use this
extension; you may not copy, redistribute, or reuse its code.

---

## What's new in 2.6.0

- **Structure** tab: Modules (with time scale and time range), Line Items (formulas searchable)
  and Lists (with properties), read from Anaplan's in-page model data.
- **Actions › Steps**: each process's actions in order, with *Copy API call*.
- **Revisions**: revision tags and every model each was applied to.
- **Lock Monitor**: watches whether the model is available, busy, locked or offline, and says
  what is running when it's busy.
- **Workspace**: deleted models (with purge date) on Current, and storage across every workspace
  on All.
- **Summary**: *Get all data* and *Download all as CSV (.zip)*.
- Every table sorts by clicking a column header.
- Large cached reports are compressed, so they survive the background worker idling out.

## What it does

Opens a side panel of reports on the Anaplan model in the active tab. Each report is gathered on
demand, grouped as in the panel's tab bar:

| Tab | Report | What it shows |
|---|---|---|
| **Summary** | | Model name, IDs, size and structure counts, and which reports are loaded. Opens automatically. |
| **Actions** | IDs | Internal IDs for processes, imports, exports, actions and files, for API integrations |
| | Usages | Where actions are used across Apps and Pages |
| | Steps | The actions each process runs, in order, with each import's source and target, plus the actions no process runs. A *Copy API call* button gives an Integration API `curl` per process and action. |
| **Pages** | Modules | Which Apps and Pages use each module (backend → frontend lineage) |
| | Filters | Line items used as page filters or for conditional formatting, each beside its condition, with the formatting colours |
| **Saved View** | List | Every saved view, grouped by module, with its ID |
| | Screens | Which saved view each App page widget reads from |
| | Actions | Imports whose source is a saved view (see the caveats below) |
| | Filters, Items | *Disabled* (see below) |
| **Structure** | Modules | Every module with its ID, dimensions, time scale, time range, line item and saved view counts, and the App pages that use it |
| | Line Items | Every line item with its ID, format, applies-to, time scale and formula. Search matches formulas too. |
| | Lists | Every list with its ID, parent and item count, and every list property with its format and formula |
| **Revisions** | | The model's revision tags (who created each, when and where) and every model each was applied to |
| **Lock** | | Checks at an interval you choose whether the model is available, busy, locked or offline, and what is running; shows a timeline and every check, exportable to CSV |
| **Workspace** | Current | Models in this workspace with size and state, and storage in use against the allowance |
| | All | Storage for every workspace you can access, and every active model across them |

**In every report:**

- **Search** with the box at the top.
- **Sort** by clicking a column header: ascending, descending, then back to the original order.
- **Export to CSV** writes the rows in the order you've sorted them.
- **Refresh** with the icon at the top right to gather a report again. Results are cached per model
  for 6 hours.

**Lock Monitor:**

- **Start monitoring** asks Anaplan what the model is doing: every second, or every 5, 15 or 30
  seconds or every minute, for up to 15 minutes, 1, 4, 8 or 12 hours (your choice is remembered).
  The report fills in while it runs and is saved as it goes. **Stop** ends it and saves it.
- **Refresh** (top right) continues monitoring and adds to the same report; the time in between
  shows as *Paused*. **Clear report** (in the report, click twice) deletes it and goes back to the
  start screen, where you can change the interval and length. *Get all data* skips the Lock Monitor.
- **Statuses:** *Available* means the model is open with nothing running. *Updating* is a change
  being saved, usually brief. *Busy* means a process, import, export or someone's change is holding
  the model, and the report shows what it is, for example "The system is currently processing an
  Export … started by … at 06:59". *Locked* and *Offline* are Anaplan refusing the model as locked
  or offline. Anaplan's times are shown in your time zone.
- **Notify me** (off unless you tick it, which asks for permission to show notifications) tells
  you when the model has been busy for 30 seconds, and when it's free again.
- **No login needed.** Each check asks for the model's status the way Anaplan's own "Model is
  busy" banner does, over your existing session, sent from the Anaplan tab. It doesn't need the
  model page to load, so it keeps working while the model is stuck loading. If that check gets no
  answer, it tries Anaplan's Integration API with the same browser login, and if Anaplan refuses
  that too, it stops and says so. It never asks for a token or password.
- **Timeline** merges checks in a row with the same status into periods. **Checks** lists every
  check.

**On Summary:**

- **Get all data** gathers every report that isn't loaded yet, one after another.
- **Download all as CSV** saves every loaded report's CSV files in one .zip.

**Notes:**

- The **Structure** reports read Anaplan's in-page model data, so they make no extra requests;
  Modules also reads the App page list. If Anaplan doesn't hold a field for a given model, that
  column stays empty and the page says so.
- **Copy API call** only copies a request to the clipboard. The extension never runs a process or
  action.

**SV Filters and SV Items are disabled** (shown greyed out, tagged *Slow*). Both have to open
every saved view, and Anaplan evaluates each view's filters before it answers. A few views on
large modules take a minute or more each, so a full run on a large model takes tens of minutes.

**SV Actions caveats.** Only imports are scanned, via `importDefinition.source`. That is the one
action source field whose shape is confirmed; the **Actions** view already shows it as "Source
Identifier". Exports and processes are not scanned. The source is an import data source
(`_113…_`), not the view itself; its definition's `objectId` names the saved view it reads. Only
data sources from the open model are resolved, so an import reading a view in *another* model
can't be named and is not listed. Both caveats are also shown on the page itself.

## Screenshots

| Summary | Actions & File IDs |
|---|---|
| ![Model Summary: IDs, size, structure counts and which reports are loaded](screenshots/summary.png) | ![Actions & File IDs view, before gathering](screenshots/actions-ids.png) |
| **Page Filters & Conditional Formatting** | **All Saved Views** |
| ![Page Filters & Conditional Formatting view, before gathering](screenshots/pages-filters.png) | ![All Saved Views view, before gathering](screenshots/saved-views-list.png) |

## Install

**From the stores:** [Chrome Web Store](https://chromewebstore.google.com/detail/anaplan-toolkit/kbbgidpmmiechmccmmjpjkidihojdgnj)
(Chrome, Edge and other Chromium browsers) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/anaplan-toolkit/)
(Firefox 140+). The stores can lag behind the latest
[GitHub release](https://github.com/umang350/AnaplanToolkit/releases).

**Unpacked, for the latest version or development.** Download `anaplan-toolkit.zip` or
`anaplan-toolkit-firefox.zip` from the [latest release](https://github.com/umang350/AnaplanToolkit/releases/latest)
and unzip it, or build both from source with `sh package.sh` (needs `jq`).

*Chrome, Edge and other Chromium browsers:*

1. Open `chrome://extensions` and turn on **Developer mode**
2. Click **Load unpacked** and select the unzipped folder (or this repository, or `dist/`)
3. Open an Anaplan model, then click the toolbar icon to open the side panel

*Firefox:*

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and select `manifest.json` in the unzipped Firefox folder (or
   in `dist-firefox/`)
3. Open an Anaplan model, then click the toolbar icon to open the sidebar

A temporary add-on is removed when Firefox restarts, so you'll need to load it again each session. Firefox 140+ is required (AMO's mandatory data-collection disclosure key,
`data_collection_permissions`, needs 140+; the `world: "MAIN"` content script used to read
Anaplan's in-page data only needs 128+).

## Keyboard shortcuts

Inside the Anaplan modelling UI (`⌘⌥` on macOS, `Ctrl+Alt` on Windows/Linux):

| Shortcut | Anaplan tab | Opens |
|---|---|---|
| `⌘⌥I` | Actions | Actions & File IDs |
| `⌘⌥O` | Actions | Action Usages |
| `⌘⌥I` | Modules | Linked Pages |
| `⌘⌥O` | Modules | Page Filters & Conditional Formatting |

## Privacy

The extension talks to **no server other than Anaplan itself**. There is no analytics, no
telemetry and no auto-update endpoint. Every call goes to Anaplan and uses your existing session:

- `/a/springboard-definition-service/...`: App page definitions
- `/a/springboard-platform-gateway-service/...`: the model list, for Workspace › All
- `/jsonrpc`: saved views, action definitions, workspace storage and revision tags
- `api.anaplan.com` (Integration API model status, sent from the Anaplan tab): the Lock Monitor
  only, and only if its session status check doesn't answer

All of these calls only read. The extension never asks for or stores a password or API token.
Results are kept in `storage.session`, compressed when large, and are dropped when the browser
closes. The Lock Monitor's interval, length and *Notify me* choice are remembered in the panel's
local storage. Nothing is sent anywhere else.

Permissions requested:

| Permission | Why |
|---|---|
| `host_permissions: https://*.anaplan.com/*` | read model metadata from the tab you have open |
| `sidePanel` (Chrome only; Firefox's sidebar needs no permission) | render the UI |
| `storage` | cache results for the session |
| `notifications` (optional, only if you tick *Notify me* on the Lock tab) | tell you when the model is busy or free again |

## Layout

```
manifest.json            extension manifest (shared; carries both Chrome's and
                         Firefox's browser-specific keys side by side)
background.js            background script: routing, caching, progress
sidepanel.{html,js,css}  side panel shell that hosts the report pages
content-scripts/
  outer.js               keyboard shortcuts in the modelling UI frame
  inner.js               report engine (fetches and assembles every report)
  main.js                MAIN-world reader for Anaplan's in-page model cache
  api.js                 relays the Lock Monitor's status calls from the Anaplan tab
chunks/                  report renderers (see Notes for maintainers) and shared helpers:
                         sv_shared.js (table, search, sort, CSV), export_all.js
                         (Download all), table_sort.js (sorting for compiled views)
*.html                   one page per report, loaded as side panel iframes
```

## Notes for maintainers

- Four report pages are compiled Svelte (`chunks/<page>-<hash>.js`): Actions IDs, Usages,
  Pages › Modules and SV Filters. There is no Svelte source in this repository; those chunks are
  committed build output. Every other report is a plain ES module on `chunks/sv_shared.js`, which
  carries its own copies of the CSV writer and the search scorer so all views behave the same.
- `popup.html` and `chunks/popup-*.js` are **not referenced by the manifest**. The side panel
  replaced the popup, and `package.sh` leaves them out.
- Files ending `.bak`, `.pre-*` and `.retired` are development snapshots. `package.sh` leaves them
  out too.
- [CLAUDE.md](CLAUDE.md) has the full architecture and the details of each report.

See [NOTICE.txt](NOTICE.txt) for third-party components and provenance.

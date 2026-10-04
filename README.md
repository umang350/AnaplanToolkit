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
| | Filters | Line items used as page filters or for conditional formatting |
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
  The report fills in while it runs. **Stop** ends it and saves it, and it's saved as it goes too.
- **Refresh** (top right) continues monitoring and adds to the same report; the time in between
  shows as *Paused*. **Clear report** (in the report, click twice) deletes it and goes back to the
  start screen, where you can change the interval and length.
  Get all data skips it.
- **Notify me** (off unless you tick it, which asks for permission to show notifications) tells
  you when the model has been busy for 30 seconds, and when it's free again.
- **Updating** is a change being saved, usually brief. **Busy** is a process, import, export or
  someone's change holding the model. Anaplan's times are shown in your time zone.
- It uses Anaplan's Integration API model status, the same status behind "Model is busy". When
  the model is busy it shows what is running, for example "The system is currently processing an
  Export … started by … at 06:59 (UTC)". It doesn't read the model page, so it keeps working when
  the model is stuck loading. Anaplan's API only accepts calls from Anaplan's own pages, so each
  check is sent from the Anaplan tab.
- **Available**: Anaplan reports the model open with nothing running. **Busy**: Anaplan names a
  running step (a process, import, export or other task), with its progress and task where given.
  **Locked** / **Offline**: the API refused the model as locked or offline.
- **No login needed, if it works for you**: each run first asks the model's status the way
  Anaplan's own screen does, over your existing session. Only if that gets no answer does it use the
  API.
- **API login**: Anaplan's API doesn't accept your browser login. If the monitor needs it, the Lock tab asks
  you to either paste an Anaplan API token (AnaplanAuthToken) or enter your Anaplan user ID and
  password. The user ID and password are swapped for a token at Anaplan's sign-in service and the
  password is not kept. Single sign-on users can only do this as SSO exception users. The token is
  kept in memory only, never saved, and renewed while the monitor runs.
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

**Unpacked, from source:**

**Chrome / Edge / other Chromium browsers**

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder (or `dist/` after running `sh package.sh`)
4. Open an Anaplan model, then click the toolbar icon to open the side panel

**Firefox**

1. Run `sh package.sh` to build `dist-firefox/`
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on** → select any file inside `dist-firefox/` (e.g. `manifest.json`)
4. Open an Anaplan model, then click the toolbar icon to open the sidebar

A temporary add-on is removed when Firefox restarts, so you'll need to reload it each session
during development. Firefox 140+ is required (AMO's mandatory data-collection disclosure key,
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
telemetry and no auto-update endpoint. Every call goes to Anaplan and uses your existing session
(or, for the Lock Monitor only, an API token you paste):

- `/a/springboard-definition-service/...`: App page definitions
- `/a/springboard-platform-gateway-service/...`: the model list, for Workspace › All
- `/jsonrpc`: saved views, action definitions, workspace storage and revision tags
- `api.anaplan.com` (Integration API model status, sent from the Anaplan tab) and
  `auth.anaplan.com` (sign-in with user ID and password, token renewal): the Lock Monitor only

All of these calls only read. Results are kept in `storage.session`, compressed when large, and
are dropped when the browser closes. Nothing is sent anywhere else.

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
chunks/                  report renderers (see below) and shared helpers:
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

# Advanced Anaplan Tool

Internal Chrome extension for analysing Anaplan models.

**Author:** Umang Chauhan
**Copyright:** © 2026 Umang Chauhan. All rights reserved.
**Licence:** Proprietary — see [LICENSE.txt](LICENSE.txt). Not for redistribution or reuse.

---

## What it does

Opens a side panel with seven reports, each gathered on demand from the Anaplan
model in the active tab:

| View | What it shows |
|---|---|
| **Actions** | Internal IDs for Processes, Imports and Files, for API integrations |
| **Usages** | Where Actions are used across Apps and Pages |
| **Modules** | Which Apps and Pages consume each module (backend → frontend lineage) |
| **Filters** | Line Items used as page filters or for conditional formatting |
| **SV Filters** | Line Items used as filters in Saved Views, with the owning module |
| **SV Screens** | Which Saved View each App Page widget reads from |
| **SV Actions** | Imports whose source is a Saved View — see the caveats below |

Every view exports to CSV and has a search box. Results are cached per model
for 6 hours; the refresh icon re-gathers.

**SV Actions caveats.** Only imports are scanned, via `importDefinition.source`
— the one action source field whose shape is confirmed (the **Actions** view
already renders it as "Source Identifier"). Exports and processes are not
scanned. A source is resolved by matching it against the saved views of the
model you have open, so an import reading a view in *another* model cannot be
named and is not listed. Both caveats are also shown on the page itself.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
4. Open an Anaplan model, then click the toolbar icon to open the side panel

## Keyboard shortcuts

Inside the Anaplan modelling UI (`⌘⌥` on macOS, `Ctrl+Alt` on Windows/Linux):

| Shortcut | Anaplan tab | Opens |
|---|---|---|
| `⌘⌥I` | Actions | Actions & File IDs |
| `⌘⌥O` | Actions | Action Usages |
| `⌘⌥I` | Modules | Linked Pages |
| `⌘⌥O` | Modules | Page Filters & Conditional Formatting |
| `⌘⌥K` | Modules | Saved View Filters |

## Privacy

The extension talks to **no server other than Anaplan itself**. There is no
analytics, no telemetry and no auto-update endpoint. The only network calls are
to `<your-anaplan-host>/a/springboard-definition-service/...` and
`<your-anaplan-host>/jsonrpc`, using your existing session. Results are held in
`chrome.storage.session` and are dropped when the browser closes.

Permissions requested:

| Permission | Why |
|---|---|
| `host_permissions: https://*.anaplan.com/*` | read model metadata from the tab you have open |
| `sidePanel` | render the UI |
| `storage` | cache results for the session |

## Layout

```
manifest.json          extension manifest
background.js          service worker: routing, caching, progress
sidepanel.{html,js,css}  side panel shell that hosts the seven report pages
content-scripts/
  outer.js             keyboard shortcuts in the modelling UI frame
  inner.js             report engine (fetches and assembles every report)
  main.js              MAIN-world reader for Anaplan's in-page model cache
chunks/                compiled report renderers, plus sv_shared.js and the
                       two hand-written SV Screens / SV Actions renderers
*.html                 the seven report pages, loaded as side panel iframes
```

## Notes for maintainers

- `popup.html` and `chunks/popup-*.js` are **not referenced by the manifest** —
  the side panel replaced the popup. They are kept only for reference and can
  be deleted.
- Files ending `.bak`, `.pre-*` and `.retired` are development snapshots.
  Delete them before packaging.
- Five of the report pages are compiled Svelte (`chunks/<page>-<hash>.js`) and
  there is no Svelte source in this repository — those chunks are committed
  build output. `sv_screens` and `sv_actions` are therefore plain ES modules
  sharing `chunks/sv_shared.js`, which carries its own copies of the CSV
  writer and the search scorer so all seven views behave identically.

See [NOTICE.txt](NOTICE.txt) for third-party components and provenance.

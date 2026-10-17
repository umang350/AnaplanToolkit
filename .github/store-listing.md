# Store listing text (Chrome Web Store and Firefox Add-ons)

Plain text on purpose: the Chrome Web Store does not render Markdown, and Firefox Add-ons shows
the same text. Paste the blocks below as they are. Not shipped in the extension package.

## Summary (manifest `description`, 132 characters at most)

Audit Anaplan models and jump through formulas with Cmd/Ctrl+click. Reports, CSV, lock monitor. Not affiliated with Anaplan.

(124 characters. The manifest still carries the older summary; copy this over `description` in
`manifest.json` to ship it.)

## Description

Anaplan Toolkit works out what is in your Anaplan model and helps you move around it faster. Open a model, click the toolbar icon, and get reports on its structure, pages, saved views, actions, workspaces, revisions and locks, each exportable to CSV. It also adds Cmd/Ctrl+click navigation and hover details to Anaplan's formula editor.

NEW: FORMULA EDITOR AND GRID HELPERS
• Cmd/Ctrl+click a module, line item, list or list subset in a formula to open it. A module opens in Blueprint view with the line item selected; a subset opens its list's Subsets tab with the subset selected. Add Shift or Alt to open a module in a new tab.
• The same click works on the lists and subsets in the Blueprint grid's Applies To column, and hovering one shows its kind, its list, its item count and the modules that use it.
• Hover a reference in a formula for its format, dimensions, time scale and formula, laid out for reading (THEN and ELSE on their own lines, indented per nested IF).
• Hover an Anaplan function (ITEM, LOOKUP, SUM, IF and more than 140 others) for its category, a short description, the syntax of common ones, and a link to Anaplan's help page.
• Markers for unbalanced brackets, unterminated quotes, and a Module.'line item' the module does not have.

REPORTS (all read-only, gathered when you ask, cached for the session)
• Summary: model name, IDs, size and structure counts, with a one-click "Get all data" and a single .zip of every report as CSV.
• Actions: internal IDs for processes, imports, exports and actions, where actions are used across Apps and Pages, and the steps each process runs, in order. A "Copy API call" button gives an Integration API curl you run yourself.
• Pages: which Apps and Pages use each module, the line items used as page filters or for conditional formatting, and every line item the widgets on the pages you choose show, and where.
• Saved Views: every saved view by module, which view each App page widget reads from, and the imports that read from a saved view.
• Structure: every module (dimensions, time scale, time range, saved view counts), every line item (format, applies-to, time scale, formula, searchable), and every list with its properties.
• Workspace: the models in the current workspace with an in-use versus allowance meter, or across every workspace you can access.
• Revisions: revision tags and the models each was applied to.
• Lock Monitor: checks the model's status as often as every second, shows who or what is holding it (an import, an export, someone's change), and keeps a timeline. Optional desktop notifications.

BULK DELETE FROM A CSV (these two views change your model)
• Delete Line Items and Delete Modules take a CSV of module and line item names (the Line Items and Modules reports export in that format). Every row is checked against the model first and nothing is deleted until you type the number to confirm. Deletes are ordered from the formulas so Anaplan does not refuse them, and the run can be paused, stopped and saved as a report and a request-by-request log.

PRIVACY
• Talks to Anaplan only, using your existing browser session. No analytics, no telemetry, no account, no other server.
• Never asks for or stores a password or API token.
• Results are kept for the browser session and dropped when it closes.
• The formula helpers read the model data the page already holds and call nothing.
• Permissions: access to anaplan.com pages (to read the model in the tab you have open), storage (to cache results), and the side panel. Notifications and downloads are optional and only requested if you turn those features on.

SUPPORT THE PROJECT
Anaplan Toolkit is free and built in spare time. If it saves you hours, you can sponsor its development: https://github.com/sponsors/umang350
Bugs and ideas: https://github.com/umang350/AnaplanToolkit/issues

Not affiliated with, endorsed by, or supported by Anaplan, Inc. "Anaplan" is a trademark of Anaplan, Inc. Reload open Anaplan tabs after installing or updating.

## Release blurb (the "what's new" box, where the store has one)

2.11: Cmd/Ctrl+click in Anaplan's formula editor and in the Blueprint Applies To column to open modules, line items, lists and subsets. Hover details for references and Anaplan functions, and markers for broken brackets and unknown line items.

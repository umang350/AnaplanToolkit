# Store listing text (Chrome Web Store and Firefox Add-ons)

Plain text on purpose: the Chrome Web Store does not render Markdown, and Firefox Add-ons shows
the same text. Paste the blocks below as they are. Not shipped in the extension package.

## Summary (manifest `description`, 132 characters at most)

Audit Anaplan models and jump through formulas with Cmd/Ctrl+click. Reports, CSV, lock monitor. Not affiliated with Anaplan.

(124 characters. The manifest still carries the older summary; copy this over `description` in
`manifest.json` to ship it.)

## Description

Anaplan Toolkit works out what is in your Anaplan model and helps you move around it faster. Open a model, click the toolbar icon, and get reports on its structure, formulas, pages, saved views, actions, workspaces, revisions and locks, each exportable to CSV. It can also run processes and other actions from a CSV, create and delete modules and line items in bulk, and it adds Cmd/Ctrl+click navigation, hover details and Planual checks to Anaplan's formula editor.

NEW: RUN ACTIONS ON ANY MODEL
• Actions > Run takes a CSV of processes, imports, exports and other actions (the IDs report exports in that format) and runs them one after another. Add a Model ID column to run actions on other models, without opening them.
• Every row is validated first and nothing starts until you type the number to confirm. Each action's own result from Anaplan is shown on its row; a failed action does not stop the run (Stop does). The run can be paused and saved as a report and a log, and export files can be downloaded as each finishes.

NEW: ANALYSIS AND PLANUAL CHECKS
• Impact: for every line item, which formulas use it and which it uses, directly and all the way down, with the modules and App pages that reach.
• Lint: checks the model against Anaplan's Planual (Classic engine), each finding showing the rule's own number. In the formula editor the part of a formula that breaks a rule is underlined; in Blueprint view a badge after the line item's name lists its findings.
• Formulas: search every formula by words, an exact phrase or a regular expression.
• Summary can save the model's lists, modules, line items and formulas as a Markdown file, or copy them as compact text for an AI assistant of your choice. Nothing is sent anywhere by the extension.

FORMULA EDITOR AND GRID HELPERS
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
• Analysis: Impact, Lint (Planual checks) and Formulas (search every formula), described above.
• Lock Monitor: checks the model's status as often as every second, shows who or what is holding it (an import, an export, someone's change), and keeps a timeline. Optional desktop notifications.

VIEWS THAT CHANGE YOUR MODEL (run from a CSV)
• Run Actions, Create Modules, Create Items, Delete Line Items and Delete Modules take a CSV (the Actions, Modules and Line Items reports export in a format they accept). Every row is checked against the model first and nothing changes until you type the number to confirm.
• Create Modules makes modules with the lists and subsets they apply to, and their line items; Create Items adds line items, with a formula and a format, to modules that exist.
• Deletes are ordered from the formulas so Anaplan does not refuse them, and runs can be paused, stopped and saved as a report and a request-by-request log.

PRIVACY
• Talks to Anaplan only, using your existing browser session. No analytics, no telemetry, no account, no other server.
• Never asks for or stores a password or API token.
• Results are kept for the browser session and dropped when it closes.
• The formula helpers read the model data the page already holds and call nothing.
• Running an action on another model talks to that model's own Anaplan server (an address Anaplan names, always on anaplan.com) with a session of its own for it, the way Anaplan's page opens a model.
• Permissions: access to anaplan.com pages (to read the model in the tab you have open), storage (to cache results), and the side panel. Notifications and downloads are optional and only requested if you turn those features on.

SUPPORT THE PROJECT
Anaplan Toolkit is free and built in spare time. If it saves you hours, you can sponsor its development: https://github.com/sponsors/umang350
Bugs and ideas: https://github.com/umang350/AnaplanToolkit/issues

Not affiliated with, endorsed by, or supported by Anaplan, Inc. "Anaplan" is a trademark of Anaplan, Inc. Reload open Anaplan tabs after installing or updating.

## Release blurb (the "what's new" box, where the store has one)

2.12: Run processes, imports and exports from a CSV, on the open model or on others without opening them. Create modules and line items from a CSV. New Analysis reports (Impact, Planual Lint, formula search), Planual markers in the formula editor, and model documentation.

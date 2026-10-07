# Changelog

Per-release notes for 2.9.0 onward live in `.github/release-notes/`; earlier entries below are
summarised from the commit history.

## Unreleased

- Housekeeping: removed the dead popup (`popup.html`, `chunks/popup-*.js`) and the two `.retired`
  view snapshots; `package.sh` now fails on a top-level HTML/JS/CSS file missing from its list and
  no longer ships `README.md`; CLAUDE.md and README corrected to match.

## 2.9.0

See [.github/release-notes/2.9.0.md](.github/release-notes/2.9.0.md). Delete Modules, whole-module
deletes in Delete Line Items, faster and more stable large deletes.

## 2.8.0

- Delete Line Items plans its order from the formulas; added Pause / Resume and auto-save of the report.
- Store listing gets a searchable title and summary; builds refuse a `version_name` that differs from `version`.

## 2.7.0

- Pages › Line Items: every line item shown on chosen App pages.
- Actions rewritten as a hand-written view so large models no longer hang; large tables no longer hang on search and sort.
- Formatting rules on hidden or filtered line items are tagged.
- Firefox-only manifest keys stripped from the Chrome build; Svelte templates built with `DOMParser` instead of `innerHTML`.
- Lock Monitor: API token and password login removed.

## 2.6.0

- Added the Lock Monitor: live model status every second, saved runs, selectable interval and length,
  opt-in notifications, continue/clear a report.

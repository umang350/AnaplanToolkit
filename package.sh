#!/bin/sh
# Build clean, shippable copies of the extension for Chrome and Firefox.
#
# Copies only the files the manifest actually needs - no development snapshots
# (.bak / .pre-* / .retired), no git history, no packaging script itself - into
# dist/ (Chrome) and dist-firefox/ (Firefox) and zips each. Run:  sh package.sh
#
# The two builds share one manifest.json: Chrome-only ("sidePanel") and
# Firefox-only ("sidebarAction") keys both sit in it, ignored by the browser
# that doesn't recognise them (background.service_worker/scripts, side_panel/
# sidebar_action, browser_specific_settings). The one thing that cannot be left
# for the other browser to ignore is the "sidePanel" *permission* string, which
# Firefox's manifest validator rejects outright - so the Firefox build strips
# it from permissions with jq.
set -eu

command -v jq >/dev/null 2>&1 || { echo "jq is required to build the Firefox package (brew install jq)" >&2; exit 1; }

OUT=dist
ZIP=anaplan-toolkit.zip
FF_OUT=dist-firefox
FF_ZIP=anaplan-toolkit-firefox.zip

rm -rf "$OUT" "$ZIP" "$FF_OUT" "$FF_ZIP"
mkdir -p "$OUT"

# Everything the extension loads at runtime, plus the licence documents.
# popup.html / chunks/popup-* are deliberately excluded: the manifest has no
# default_popup, so the side panel is the only UI and they are dead code.
for f in manifest.json background.js \
         sidepanel.html sidepanel.js sidepanel.css views.css \
         actions.html action_usages.html pages.html filter_items.html sv_filter_items.html \
         sv_views.html sv_line_items.html sv_screens.html sv_actions.html \
         icon-16.png icon-32.png icon-48.png icon-128.png \
         LICENSE.txt NOTICE.txt README.md; do
  [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
  cp "$f" "$OUT/"
done

for d in chunks content-scripts assets fonts; do
  [ -d "$d" ] || continue
  mkdir -p "$OUT/$d"
  find "$d" -type f \
    ! -name '*.bak' ! -name '*.pre-*' ! -name '*.retired' ! -name '.DS_Store' \
    ! -name 'popup-*' \
    -exec cp {} "$OUT/$d/" \;
done

# Sanity: nothing from the development history should have slipped through.
if find "$OUT" -name '*.bak' -o -name '*.pre-*' -o -name '*.retired' | grep -q .; then
  echo "development snapshots leaked into $OUT" >&2; exit 1
fi

( cd "$OUT" && zip -qr "../$ZIP" . )
echo "built $ZIP  ($(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1))"

# Firefox build: same tree, minus the Chrome-only "sidePanel" permission
# string that Firefox's manifest validator rejects (see note above).
cp -R "$OUT" "$FF_OUT"
jq '.permissions -= ["sidePanel"]' manifest.json > "$FF_OUT/manifest.json"

( cd "$FF_OUT" && zip -qr "../$FF_ZIP" . )
echo "built $FF_ZIP  ($(find "$FF_OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$FF_OUT" | cut -f1))"

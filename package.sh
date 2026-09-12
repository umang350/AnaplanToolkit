#!/bin/sh
# Build a clean, shippable copy of the extension.
#
# Copies only the files the manifest actually needs - no development snapshots
# (.bak / .pre-* / .retired), no git history, no packaging script itself - into
# dist/ and zips it. Run:  sh package.sh
set -eu

OUT=dist
ZIP=anaplan-toolkit.zip

rm -rf "$OUT" "$ZIP"
mkdir -p "$OUT"

# Everything the extension loads at runtime, plus the licence documents.
# popup.html / chunks/popup-* are deliberately excluded: the manifest has no
# default_popup, so the side panel is the only UI and they are dead code.
for f in manifest.json background.js \
         sidepanel.html sidepanel.js sidepanel.css views.css \
         actions.html action_usages.html pages.html filter_items.html sv_filter_items.html \
         sv_screens.html sv_actions.html \
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

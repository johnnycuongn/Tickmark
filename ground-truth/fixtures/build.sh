#!/usr/bin/env bash
# Render every synthetic fixture HTML to ground-truth/docs/<stem>.pdf.
#
# WHY A SCRIPT AND NOT A README SNIPPET: the PDFs are build output, derived from the HTML
# next to this file. Committing them would mean committing a binary that can silently
# disagree with its source. Regenerate instead: `npm run fixtures`.
#
# WHY CHROME: already on this machine, renders the CSS we authored, adds no dependency to
# package.json. The cost is that it is macOS/Chrome-specific — if this ever needs to run in
# CI, swap this one file for Playwright and nothing else in the project changes.
#
# WHY THE KILL: Chrome 152 writes the PDF in about a second and then does not exit. Waiting
# on the process hangs forever, so we wait on the artefact instead — poll for the output
# file to appear and stop growing, then kill the browser. Ugly, deliberate, and confined to
# these six lines rather than smeared through the project.
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/ground-truth/docs"
mkdir -p "$OUT"

# A throwaway profile: without it Chrome refuses to start headless while your normal
# browser window holds a lock on the default profile.
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

pause() { perl -e 'select(undef,undef,undef,0.3)'; }

count=0
for html in "$ROOT"/ground-truth/fixtures/*.html; do
  stem="$(basename "$html" .html)"
  pdf="$OUT/$stem.pdf"
  rm -f "$pdf"

  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --no-first-run --no-default-browser-check --disable-background-networking \
    --disable-sync --disable-extensions --virtual-time-budget=2000 \
    --user-data-dir="$PROFILE" \
    --print-to-pdf="$pdf" "file://$html" >/dev/null 2>&1 &
  pid=$!

  # Wait for the file to exist and hold the same size across two polls (~30s ceiling).
  last=-1
  for _ in $(seq 1 100); do
    pause
    [ -f "$pdf" ] || continue
    size=$(stat -f%z "$pdf")
    [ "$size" -gt 0 ] && [ "$size" -eq "$last" ] && break
    last=$size
  done

  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true

  if [ ! -s "$pdf" ]; then echo "FAILED: $stem" >&2; exit 1; fi
  printf '  %-30s %7s bytes\n' "$stem" "$(stat -f%z "$pdf")"
  count=$((count + 1))
done

echo "Rendered $count fixtures to ground-truth/docs/"

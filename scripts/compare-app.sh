#!/usr/bin/env bash
#
# Launch the grale compare app: the Vite dev server plus its engine-running
# backend (so the app can run engines, browse graph-test-data, and compare
# snapshot runs). Opens the app in the default browser.
#
#   scripts/compare-app.sh            # or: npm run app
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

URL="http://localhost:5173"
# open the browser shortly after the server comes up (best-effort, non-fatal)
( sleep 2.5
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi ) >/dev/null 2>&1 &

echo "starting compare app at $URL …"
exec npm run dev

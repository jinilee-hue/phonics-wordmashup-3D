#!/bin/bash
# Word Mashup 3D — 더블클릭하면 로컬 서버(5183)를 띄우고 브라우저를 엽니다.
cd "$(dirname "$0")" || exit 1
PORT=5183
URL="http://127.0.0.1:$PORT/"
if curl -s -o /dev/null --max-time 1 "$URL"; then
  open "$URL?v=$(date +%s)"
  exit 0
fi
[ -d node_modules ] || npm install
(sleep 2; open "$URL") &
npx vite --port "$PORT" --strictPort --host 127.0.0.1

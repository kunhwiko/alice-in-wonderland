#!/usr/bin/env bash
# Claude Code Notification hook -> Wonderland.
#
# Reports sessions running in terminal tabs so they show up in the queue.
# Exits 0 unconditionally and times out fast, so a stopped Wonderland can
# never block or slow a Claude session.
payload=$(cat)
curl -sS --max-time 2 -X POST -H 'Content-type: application/json' \
  -d "$payload" http://127.0.0.1:7777/api/hook >/dev/null 2>&1
exit 0

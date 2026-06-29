#!/bin/bash
# UserPromptSubmit hook: when a prompt is about live tournament data, fetch the Cloudflare
# Worker /live feed (the real-time source) and inject a fresh digest into context — so answers
# are never built from the stale committed public/data/live.json. ponytail: keyword-gated +
# the Worker caches ~60s, so this is one cheap request only on data-shaped prompts.
LIVE_URL="https://worldcup26-live.debaditya-chatterjee.workers.dev/live"
DUMP=/tmp/wc26-live.json
HERE="$(cd "$(dirname "$0")" && pwd)"

prompt=$(jq -r '.prompt // empty' 2>/dev/null)
# Gate: only fire for data-shaped prompts (scores, scorers, bracket, standings, who-won, …).
echo "$prompt" | grep -qiE 'score|scorer|golden boot|result|standing|table|bracket|knockout|qualif|group|fixture|today|live|won|win|lost|goal|match|r32|r16|round of|quarter|semi|final|advance|eliminat|shootout|penalt|who |stat' || exit 0

if ! curl -s --max-time 12 "$LIVE_URL" -o "$DUMP" 2>/dev/null || [ ! -s "$DUMP" ]; then
  echo "[wc-live] Could not reach the live Worker feed. Do NOT trust public/data/live.json for current scores — say the feed is unreachable instead."
  exit 0
fi

node "$HERE/wc-live-digest.mjs" "$DUMP" 2>/dev/null \
  || echo "[wc-live] Feed fetched to $DUMP but digest failed — read $DUMP directly; do not use public/data/live.json."
exit 0

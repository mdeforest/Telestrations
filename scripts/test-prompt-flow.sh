#!/usr/bin/env bash
# test-prompt-flow.sh
#
# Interactive test harness: you are the host + 4th player.
# Three bots join your room and select prompts on cue.
#
# Usage:
#   ./scripts/test-prompt-flow.sh [BASE_URL]
#
# Defaults to http://localhost:3000

set -euo pipefail

BASE="${1:-http://192.168.86.35:3000}"
JARS=(/tmp/tele_bot1.txt /tmp/tele_bot2.txt /tmp/tele_bot3.txt)
NAMES=("Alice" "Bob" "Carol")

cleanup() { rm -f "${JARS[@]}"; }
trap cleanup EXIT

log()  { echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

json_get() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2') or '')"
}

# ── Step 1: get room code from user ─────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  1. Open $BASE in your browser"
echo "  2. Create a room (you are the host)"
echo "  3. Paste the room code below"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "  Room code: " CODE
CODE=$(echo "$CODE" | tr '[:lower:]' '[:upper:]')
echo ""

# ── Step 2: bots join ────────────────────────────────────────────────────────

for i in 0 1 2; do
  log "Joining as ${NAMES[$i]}…"
  JOIN=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    -X POST "$BASE/api/rooms/$CODE/join" \
    -H "Content-Type: application/json" \
    -d "{\"nickname\":\"${NAMES[$i]}\"}")
  SEAT=$(json_get "$JOIN" "seatOrder")
  [[ -n "$SEAT" ]] || fail "Join failed for ${NAMES[$i]}: $JOIN"
  ok "${NAMES[$i]} joined (seat $SEAT)"
done

# ── Step 3: wait for host to start ──────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  All 4 players are in the room."
echo "  Start the game in your browser, then press Enter."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "  [Enter after you hit Start] "
echo ""

# ── Step 4: poll for round ID ────────────────────────────────────────────────

log "Waiting for game to start…"
ROUND_ID=""
for attempt in $(seq 1 10); do
  STATUS_RESP=$(curl -sf "$BASE/api/rooms/$CODE" || true)
  STATUS=$(json_get "$STATUS_RESP" "status")
  ROUND_ID=$(json_get "$STATUS_RESP" "roundId")

  if [[ "$STATUS" == "prompts" && -n "$ROUND_ID" ]]; then
    ok "Game started — Round ID: $ROUND_ID"
    break
  fi

  if [[ $attempt -eq 10 ]]; then
    fail "Room is not in prompts phase after 10 attempts (status=$STATUS). Did you hit Start?"
  fi

  sleep 1
done

# ── Step 5: bots select prompts ─────────────────────────────────────────────

echo ""
echo "  Your browser should show the prompt selection screen."
echo "  Bots will select in 5 seconds — pick yours before or after, up to you."
echo ""
sleep 5

for i in 0 1 2; do
  OPTS=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    "$BASE/api/rounds/$ROUND_ID/prompts")

  ALREADY=$(json_get "$OPTS" "alreadySelected")
  if [[ "$ALREADY" == "True" || "$ALREADY" == "true" ]]; then
    ok "${NAMES[$i]} already selected"
    continue
  fi

  PROMPT_ID=$(echo "$OPTS" | python3 -c \
    "import sys,json; opts=json.load(sys.stdin)['options']; print(opts[0]['id']) if opts else print('')")
  [[ -n "$PROMPT_ID" ]] || fail "${NAMES[$i]}: no prompt options returned"

  PROMPT_TEXT=$(echo "$OPTS" | python3 -c \
    "import sys,json; opts=json.load(sys.stdin)['options']; print(opts[0]['text']) if opts else print('')")

  curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    -X POST "$BASE/api/rounds/$ROUND_ID/prompt" \
    -H "Content-Type: application/json" \
    -d "{\"promptId\":\"$PROMPT_ID\"}" > /dev/null

  ok "${NAMES[$i]} selected: \"$PROMPT_TEXT\""
done

echo ""
echo "  3 of 4 done. Select your prompt in the browser to kick off the round."

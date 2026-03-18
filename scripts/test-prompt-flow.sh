#!/usr/bin/env bash
# test-prompt-flow.sh
#
# Simulates 4 players going through the full prompt-selection phase:
#   create room → join × 3 → start → fetch prompts → all select → active
#
# Usage:
#   ./scripts/test-prompt-flow.sh [BASE_URL]
#
# Defaults to http://localhost:3000

set -euo pipefail

BASE="${1:-http://localhost:3000}"
JARS=(/tmp/tele_p1.txt /tmp/tele_p2.txt /tmp/tele_p3.txt /tmp/tele_p4.txt)
NAMES=("Alice" "Bob" "Carol" "Dave")

cleanup() { rm -f "${JARS[@]}"; }
trap cleanup EXIT

# ── helpers ────────────────────────────────────────────────────────────────

log()  { echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

json_get() {
  # json_get <json_string> <key>
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))"
}

# ── 1. Create room ──────────────────────────────────────────────────────────

log "Creating room as ${NAMES[0]}…"
CREATE=$(curl -sf -c "${JARS[0]}" -b "${JARS[0]}" \
  -X POST "$BASE/api/rooms" \
  -H "Content-Type: application/json" \
  -d "{\"nickname\":\"${NAMES[0]}\"}")

CODE=$(json_get "$CREATE" "code")
[[ -n "$CODE" ]] || fail "No room code in response: $CREATE"
ok "Room code: $CODE"

# ── 2. Join with 3 more players ─────────────────────────────────────────────

for i in 1 2 3; do
  log "Joining as ${NAMES[$i]}…"
  JOIN=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    -X POST "$BASE/api/rooms/$CODE/join" \
    -H "Content-Type: application/json" \
    -d "{\"nickname\":\"${NAMES[$i]}\"}")
  SEAT=$(json_get "$JOIN" "seatOrder")
  ok "${NAMES[$i]} joined (seat $SEAT)"
done

# ── 3. Start game ────────────────────────────────────────────────────────────

log "Starting game…"
START=$(curl -sf -c "${JARS[0]}" -b "${JARS[0]}" \
  -X POST "$BASE/api/rooms/$CODE/start" \
  -H "Content-Type: application/json" \
  -d '{"numRounds":3,"scoringMode":"friendly"}')

ROUND_ID=$(json_get "$START" "roundId")
[[ -n "$ROUND_ID" ]] || fail "No roundId in start response: $START"
ok "Round ID: $ROUND_ID"

# ── 4 & 5. Each player fetches options and selects ───────────────────────────

ALL_SELECTED=""
for i in 0 1 2 3; do
  log "${NAMES[$i]} fetching prompt options…"
  OPTS=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    "$BASE/api/rounds/$ROUND_ID/prompts")

  ALREADY=$(json_get "$OPTS" "alreadySelected")
  if [[ "$ALREADY" == "True" || "$ALREADY" == "true" ]]; then
    ok "${NAMES[$i]} already selected (skip)"
    continue
  fi

  PROMPT_ID=$(echo "$OPTS" | python3 -c \
    "import sys,json; opts=json.load(sys.stdin)['options']; print(opts[0]['id']) if opts else print('')")
  [[ -n "$PROMPT_ID" ]] || fail "${NAMES[$i]}: no prompt options returned"

  PROMPT_TEXT=$(echo "$OPTS" | python3 -c \
    "import sys,json; opts=json.load(sys.stdin)['options']; print(opts[0]['text']) if opts else print('')")

  log "${NAMES[$i]} selecting: \"$PROMPT_TEXT\"…"
  SELECT=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    -X POST "$BASE/api/rounds/$ROUND_ID/prompt" \
    -H "Content-Type: application/json" \
    -d "{\"promptId\":\"$PROMPT_ID\"}")

  ALL_SELECTED=$(json_get "$SELECT" "allSelected")
  ok "${NAMES[$i]} selected (allSelected=$ALL_SELECTED)"
done

# ── Result ───────────────────────────────────────────────────────────────────

echo ""
if [[ "$ALL_SELECTED" == "True" || "$ALL_SELECTED" == "true" ]]; then
  echo "✅  All players selected — room transitioned to active"
else
  echo "⚠️  Last allSelected=$ALL_SELECTED (may already have been active, or check room status)"
fi

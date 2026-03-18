#!/usr/bin/env bash
# test-prompt-flow.sh
#
# Simulates 3 bot players + waits for you (the 4th) to join and select manually.
#
# Flow:
#   1. Bots create room + join (Alice as host, Bob and Carol as players)
#   2. Prints room code — you open the browser and join as the 4th player
#   3. Press Enter — bots start the game
#   4. Browser shows prompt selection; bots select their prompts after a short delay
#   5. You select yours in the browser — room transitions to active
#
# Usage:
#   ./scripts/test-prompt-flow.sh [BASE_URL]
#
# Defaults to http://localhost:3000

set -euo pipefail

BASE="${1:-http://localhost:3000}"
JARS=(/tmp/tele_p1.txt /tmp/tele_p2.txt /tmp/tele_p3.txt)
NAMES=("Alice" "Bob" "Carol")

cleanup() { rm -f "${JARS[@]}"; }
trap cleanup EXIT

# ── helpers ────────────────────────────────────────────────────────────────

log()  { echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

json_get() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))"
}

# ── 1. Create room ──────────────────────────────────────────────────────────

log "Creating room as ${NAMES[0]} (host)…"
CREATE=$(curl -sf -c "${JARS[0]}" -b "${JARS[0]}" \
  -X POST "$BASE/api/rooms" \
  -H "Content-Type: application/json" \
  -d "{\"nickname\":\"${NAMES[0]}\"}")

CODE=$(json_get "$CREATE" "code")
[[ -n "$CODE" ]] || fail "No room code in response: $CREATE"
ok "Room code: $CODE"

# ── 2. Two more bots join ────────────────────────────────────────────────────

for i in 1 2; do
  log "Joining as ${NAMES[$i]}…"
  JOIN=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    -X POST "$BASE/api/rooms/$CODE/join" \
    -H "Content-Type: application/json" \
    -d "{\"nickname\":\"${NAMES[$i]}\"}")
  SEAT=$(json_get "$JOIN" "seatOrder")
  ok "${NAMES[$i]} joined (seat $SEAT)"
done

# ── 3. Wait for you ──────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Room code: $CODE"
echo "  Open: $BASE/room/$CODE"
echo "  Join as the 4th player in your browser, then press Enter."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -r -p "  [Enter when you've joined] "
echo ""

# ── 4. Start game ────────────────────────────────────────────────────────────

log "Starting game (as Alice)…"
START=$(curl -sf -c "${JARS[0]}" -b "${JARS[0]}" \
  -X POST "$BASE/api/rooms/$CODE/start" \
  -H "Content-Type: application/json" \
  -d '{"numRounds":3,"scoringMode":"friendly"}')

ROUND_ID=$(json_get "$START" "roundId")
[[ -n "$ROUND_ID" ]] || fail "No roundId in start response: $START"
ok "Round started — ID: $ROUND_ID"

# ── 5. Bots select prompts after a short delay ───────────────────────────────

echo ""
echo "  Your browser should now show the prompt selection screen."
echo "  Bots will select their prompts in 5 seconds…"
sleep 5

for i in 0 1 2; do
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

  SELECT=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
    -X POST "$BASE/api/rounds/$ROUND_ID/prompt" \
    -H "Content-Type: application/json" \
    -d "{\"promptId\":\"$PROMPT_ID\"}")

  ok "${NAMES[$i]} selected: \"$PROMPT_TEXT\""
done

echo ""
echo "  3 of 4 players have selected."
echo "  Select your prompt in the browser to start the round."

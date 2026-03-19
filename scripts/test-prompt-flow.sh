#!/usr/bin/env bash
# test-prompt-flow.sh
#
# Interactive test harness: you are the host + 4th player.
# Three bots join your room, select prompts, and submit drawings each pass.
#
# Usage:
#   ./scripts/test-prompt-flow.sh [BASE_URL]
#
# Defaults to http://localhost:3000

set -euo pipefail

BASE="${1:-http://192.168.86.35:3000}"
JARS=(/tmp/tele_bot1.txt /tmp/tele_bot2.txt /tmp/tele_bot3.txt)
NAMES=("Alice" "Bob" "Carol")
# 4 players → chainLength = 4 passes per round (even player count)
CHAIN_LENGTH=4

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
echo "  3 of 4 done. Select your prompt in the browser to kick off the drawing phase."
echo ""

# ── Step 6: wait for active status ──────────────────────────────────────────

log "Waiting for drawing phase to begin…"
for attempt in $(seq 1 15); do
  STATUS_RESP=$(curl -sf "$BASE/api/rooms/$CODE" || true)
  STATUS=$(json_get "$STATUS_RESP" "status")
  if [[ "$STATUS" == "active" ]]; then
    ok "Drawing phase started"
    break
  fi
  if [[ $attempt -eq 15 ]]; then
    fail "Room never reached active status (status=$STATUS)"
  fi
  sleep 1
done

# ── Step 7: drawing passes ───────────────────────────────────────────────────
# With 4 players chainLength = 4 passes.
# For each pass: bots look up their entry and submit an empty drawing,
# then wait for the human to submit from the browser.

EMPTY_STROKES="[]"

for pass in $(seq 1 $CHAIN_LENGTH); do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  PASS $pass of $CHAIN_LENGTH"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Bots submit their entries for this pass
  BOT_SUBMITTED=0
  for i in 0 1 2; do
    ENTRY_RESP=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
      "$BASE/api/rounds/$ROUND_ID/my-entry" 2>/dev/null || echo "{}")

    BOOK_ID=$(json_get "$ENTRY_RESP" "bookId")
    PASS_NUM=$(json_get "$ENTRY_RESP" "passNumber")
    ALREADY_SUB=$(json_get "$ENTRY_RESP" "alreadySubmitted")

    if [[ "$ALREADY_SUB" == "True" || "$ALREADY_SUB" == "true" ]]; then
      ok "${NAMES[$i]} already submitted for pass $pass"
      BOT_SUBMITTED=$((BOT_SUBMITTED + 1))
      continue
    fi

    if [[ -z "$BOOK_ID" || -z "$PASS_NUM" ]]; then
      ok "${NAMES[$i]}: no entry for this pass (may be on a different pass)"
      continue
    fi

    SUBMIT_RESP=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
      -X POST "$BASE/api/entries" \
      -H "Content-Type: application/json" \
      -d "{\"bookId\":\"$BOOK_ID\",\"passNumber\":$PASS_NUM,\"type\":\"drawing\",\"content\":\"$EMPTY_STROKES\"}" \
      2>/dev/null || echo "{}")

    if echo "$SUBMIT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'error' not in d else 1)" 2>/dev/null; then
      ok "${NAMES[$i]} submitted drawing for pass $pass (book $BOOK_ID)"
      BOT_SUBMITTED=$((BOT_SUBMITTED + 1))
    else
      ERR=$(json_get "$SUBMIT_RESP" "error")
      ok "${NAMES[$i]} skipped (${ERR:-unknown})"
    fi
  done

  if [[ $pass -lt $CHAIN_LENGTH ]]; then
    echo ""
    echo "  $BOT_SUBMITTED/3 bots submitted. Submit YOUR drawing in the browser, then press Enter."
    read -r -p "  [Enter after you submit] "

    # Poll for pass to advance
    log "Waiting for pass $pass to complete…"
    for attempt in $(seq 1 15); do
      STATUS_RESP=$(curl -sf "$BASE/api/rooms/$CODE" || true)
      CURR_PASS=$(json_get "$STATUS_RESP" "currentPass")
      NEXT_PASS=$((pass + 1))
      if [[ "$CURR_PASS" == "$NEXT_PASS" ]]; then
        ok "Advanced to pass $NEXT_PASS"
        break
      fi
      if [[ $attempt -eq 15 ]]; then
        log "Pass did not auto-advance (currentPass=$CURR_PASS). Continuing anyway."
        break
      fi
      sleep 1
    done
  else
    echo ""
    echo "  $BOT_SUBMITTED/3 bots submitted. Submit YOUR final drawing in the browser."
    echo "  The round should complete and the game will advance."
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  All $CHAIN_LENGTH passes complete. Drawing phase done!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

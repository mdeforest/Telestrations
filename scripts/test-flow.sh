#!/usr/bin/env bash
# test-flow.sh
#
# Interactive test harness: you are the host + 4th player.
# Three bots join your room, select prompts, and submit entries (drawing or guess)
# each pass, alternating per the entryType rule (odd pass = drawing, even = guess).
# Handles multi-round games — loops until the game reaches reveal status.
#
# Usage:
#   ./scripts/test-flow.sh [BASE_URL]
#
# Defaults to http://localhost:3000

set -euo pipefail

BASE="${1:-http://localhost:3000}"
JARS=(/tmp/tele_bot1.txt /tmp/tele_bot2.txt /tmp/tele_bot3.txt)
NAMES=("Alice" "Bob" "Carol")
# 4 players → chainLength = 4 passes per round (even player count)
CHAIN_LENGTH=4

EMPTY_STROKES="[]"
BOT_GUESS_TEXT="A squiggly thing"

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

# ── Step 4: poll for first round ID ─────────────────────────────────────────

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

# ── Round loop: repeats for each round until reveal ──────────────────────────

ROUND_NUM=0

while true; do
  ROUND_NUM=$((ROUND_NUM + 1))

  echo ""
  echo "┌─────────────────────────────────────────────────┐"
  echo "  ROUND $ROUND_NUM  (round ID: $ROUND_ID)"
  echo "└─────────────────────────────────────────────────┘"

  # ── Prompt selection ─────────────────────────────────────────────────────

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

  # ── Wait for active status ───────────────────────────────────────────────

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

  # ── Passes (alternating drawing / guess) ────────────────────────────────
  # Pass 1: drawing (odd), Pass 2: guess (even), Pass 3: drawing, Pass 4: guess
  # Entry type is read from the my-entry response, not computed locally.

  for pass in $(seq 1 $CHAIN_LENGTH); do
    if (( pass % 2 == 1 )); then
      PHASE_LABEL="DRAWING"
    else
      PHASE_LABEL="GUESSING"
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ROUND $ROUND_NUM — PASS $pass of $CHAIN_LENGTH — $PHASE_LABEL PHASE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    BOT_SUBMITTED=0
    for i in 0 1 2; do
      ENTRY_RESP=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
        "$BASE/api/rounds/$ROUND_ID/my-entry" 2>/dev/null || echo "{}")

      BOOK_ID=$(json_get "$ENTRY_RESP" "bookId")
      PASS_NUM=$(json_get "$ENTRY_RESP" "passNumber")
      ALREADY_SUB=$(json_get "$ENTRY_RESP" "alreadySubmitted")
      ENTRY_TYPE=$(json_get "$ENTRY_RESP" "type")

      if [[ "$ALREADY_SUB" == "True" || "$ALREADY_SUB" == "true" ]]; then
        ok "${NAMES[$i]} already submitted for pass $pass"
        BOT_SUBMITTED=$((BOT_SUBMITTED + 1))
        continue
      fi

      if [[ -z "$BOOK_ID" || -z "$PASS_NUM" ]]; then
        ok "${NAMES[$i]}: no entry for this pass (may be on a different pass)"
        continue
      fi

      if [[ "$ENTRY_TYPE" == "guess" ]]; then
        PAYLOAD="{\"bookId\":\"$BOOK_ID\",\"passNumber\":$PASS_NUM,\"type\":\"guess\",\"content\":\"$BOT_GUESS_TEXT\"}"
        SUBMIT_LABEL="guess"
      else
        PAYLOAD="{\"bookId\":\"$BOOK_ID\",\"passNumber\":$PASS_NUM,\"type\":\"drawing\",\"content\":\"$EMPTY_STROKES\"}"
        SUBMIT_LABEL="drawing"
      fi

      SUBMIT_RESP=$(curl -sf -c "${JARS[$i]}" -b "${JARS[$i]}" \
        -X POST "$BASE/api/entries" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        2>/dev/null || echo "{}")

      if echo "$SUBMIT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'error' not in d else 1)" 2>/dev/null; then
        ok "${NAMES[$i]} submitted $SUBMIT_LABEL for pass $pass (book $BOOK_ID)"
        BOT_SUBMITTED=$((BOT_SUBMITTED + 1))
      else
        ERR=$(json_get "$SUBMIT_RESP" "error")
        ok "${NAMES[$i]} skipped (${ERR:-unknown})"
      fi
    done

    if [[ $pass -lt $CHAIN_LENGTH ]]; then
      echo ""
      echo "  $BOT_SUBMITTED/3 bots submitted. Submit YOUR $PHASE_LABEL entry in the browser, then press Enter."
      read -r -p "  [Enter after you submit] "

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
      echo "  $BOT_SUBMITTED/3 bots submitted. Submit YOUR final $PHASE_LABEL entry in the browser."
      read -r -p "  [Enter after you submit your final entry] "
    fi
  done

  # ── After last pass: check for reveal or next round ─────────────────────

  echo ""
  log "Waiting for round $ROUND_NUM to complete…"
  ADVANCED=false
  for attempt in $(seq 1 20); do
    STATUS_RESP=$(curl -sf "$BASE/api/rooms/$CODE" || true)
    STATUS=$(json_get "$STATUS_RESP" "status")
    log "  (attempt $attempt/20 — status: ${STATUS:-unknown})"

    if [[ "$STATUS" == "reveal" ]]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  All rounds complete → status: reveal ✓"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      ADVANCED=true
      break 2  # exit the round loop entirely
    fi

    if [[ "$STATUS" == "prompts" ]]; then
      NEW_ROUND_ID=$(json_get "$STATUS_RESP" "roundId")
      if [[ -n "$NEW_ROUND_ID" && "$NEW_ROUND_ID" != "$ROUND_ID" ]]; then
        ok "Round $ROUND_NUM complete → starting round $((ROUND_NUM + 1)) (roundId: $NEW_ROUND_ID)"
        ROUND_ID="$NEW_ROUND_ID"
        ADVANCED=true
        break  # continue the while loop for next round
      fi
    fi

    if [[ $attempt -eq 20 ]]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "  Round did not advance after 20s (status=$STATUS)."
      echo "  Submit your final entry in the browser if you haven't."
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      break 2
    fi

    sleep 1
  done

  [[ "$ADVANCED" == "true" ]] || break
done

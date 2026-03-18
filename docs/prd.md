# PRD: Telestrations Web App — Full Implementation

## Problem Statement

There is no good, freely accessible web version of Telestrations that supports the full game experience at party scale. Existing options either require app installs, lack a proper host screen, or don't faithfully implement chain routing, simultaneous play, and the cinematic reveal. Groups who want to play Telestrations remotely or on a shared TV screen have no solid option.

## Solution

Build a browser-based, internet-hosted Telestrations clone using Next.js, Neon (Postgres), and Ably (Realtime). Players join rooms via a 6-character code with no accounts required. The game supports 4–12 players with a host screen (TV/laptop) and player phones as separate UI surfaces. All game state is server-authoritative; Ably propagates updates to all connected clients.

## User Stories

### Lobby & Room Management

1. As a player, I want to create a new room so that I can host a game for my group.
2. As a player who creates a room, I want to automatically become the host so that I can control the game flow.
3. As a player, I want to join a room using a 6-character code so that I can participate without creating an account.
4. As a player, I want to enter only a nickname when joining so that there is no sign-up friction.
5. As a host, I want to see a live list of all players who have joined the lobby so that I know when everyone is ready.
6. As a joining player, I want to see the room's player list update in real time so that I know who else is in the game.
7. As a host, I want to configure the number of rounds before starting so that I can adjust game length.
8. As a host, I want to choose between friendly and competitive scoring modes before starting so that the group agrees on stakes.
9. As a host, I want a "Start Game" button that is only active when enough players (≥4) have joined so that the game can't begin too early.
10. As a player on a phone, I want the lobby to show the room code prominently so that I can share it easily.
11. As a host screen (TV), I want to display the room code in large text so that players across the room can see it.

### Prompt Selection

12. As a player, I want to see 2–3 prompt options at the start of each round so that I have agency over what I draw.
13. As a player, I want my prompt selection to be kept secret from other players so that the chain works correctly.
14. As a host, I want all players to be held at the prompt screen until everyone has selected so that the round starts together.
15. As a player, I want a timer or indication that others are still choosing so that I know the round hasn't started yet.

### Drawing Phase

16. As a player, I want a finger/mouse canvas to draw on during my drawing turns so that I can create sketches on my phone.
17. As a player, I want a 60-second timer visible on my screen while drawing so that I know how much time I have.
18. As a player, I want to submit my drawing before the timer expires so that I can indicate I'm done early.
19. As a player who has submitted early, I want to see a "Waiting for others" screen so that I'm not confused about game state.
20. As a player, I want the round to advance automatically when all players submit or the timer expires so that the game doesn't stall.
21. As a player, I want to be able to adjust brush size while drawing so that I can add detail or broad strokes.
22. As the host screen, I want to see the countdown timer and which players haven't submitted yet so that I can track progress.
23. As a player, I want to draw on my phone with touch input so that the canvas feels natural.

### Guessing Phase

24. As a player receiving a drawing, I want to see the drawing I need to guess and a text input so that I can write my best guess.
25. As a player, I want the 60-second guessing timer to behave the same as the drawing timer so that rounds feel consistent.
26. As a player, I want to submit my guess early if I'm confident so that I don't have to wait out the full timer.
27. As a player, I want a "Waiting for others" screen after submitting my guess so that I know the game is still running.

### Chain Routing

28. As the system, I want to route books correctly for even player counts (chain length = N, owner draws first) so that the game is faithful to the original rules.
29. As the system, I want to route books correctly for odd player counts (chain length = N−1, owner writes but doesn't draw, last entry is always a guess) so that odd groups play correctly.
30. As a player, I want to always receive the correct book for my pass number so that no one accidentally sees the wrong chain.
31. As the system, I want to compute which player authors each entry based on seat order so that pass routing is deterministic and auditable.

### Disconnection Handling

32. As the game system, I want to mark a disconnected player's book entry as blank and continue the round so that one player's disconnect doesn't end the game.
33. As a connected player, I want the game to continue if someone disconnects so that I don't lose my progress.
34. As a host, I want to see which players are disconnected on the host screen so that I'm aware of the situation.

### Reveal Phase

35. As the host, I want to advance through each entry in the currently revealed book manually so that the group can react together.
36. As the host, I want to advance the reveal from either the TV browser or my phone so that I don't have to walk to the TV.
37. As a player, I want my phone to highlight the entry I personally contributed when its book is being revealed so that I can see my work in context.
38. As all players, I want books to be revealed one at a time (not all simultaneously) so that each reveal gets group attention.
39. As the host screen, I want to display the current book's chain entry (drawing or guess) in a cinematic, full-screen layout so that it's visible to the whole room.
40. As a player watching the reveal, I want to see the progression from original prompt → drawing → guess → drawing → … so that I can follow the chain's mutation.

### Scoring — Friendly Mode

41. As a player, I want to vote for my favorite sketch in each revealed book so that the best art gets recognized.
42. As a player, I want to vote for my favorite guess in each revealed book so that clever guesses are rewarded.
43. As the game system, I want to tally votes and award 1 point per vote received so that a leaderboard can be shown.
44. As a player, I want to see the final scoreboard after all books are revealed and votes are tallied so that I know who won.

### Scoring — Competitive Mode

45. As the game system, I want to compute a fuzzy string match between each guess and the prior drawing's label so that I can auto-detect correct guesses.
46. As the book owner, I want to override the fuzzy match result (mark correct or incorrect) for my own book during reveal so that obviously right or wrong guesses are scored accurately.
47. As a player who guessed correctly, I want to receive 1 point so that good guessing is rewarded.
48. As a player whose drawing led to a correct guess, I want to receive 1 point so that good drawing is also rewarded.
49. As a player, I want to see the final competitive leaderboard after all books are scored so that the winner is clear.

### Host Screen (TV/Laptop)

50. As a host screen, I want to show the lobby player list and room code at large scale so that it is visible across the room.
51. As a host screen, I want to show the active-round timer and pending-submission player list so that the room can watch progress.
52. As a host screen, I want to display the reveal chain entries full-screen so that everyone watching can see drawings and guesses.
53. As a host, I want the TV screen and my phone to stay in sync via Ably so that neither gets out of date.

### Realtime & State

54. As a player, I want all game state changes (round advance, timer start, reveal progress) to propagate to my device within ~1 second so that the game feels live.
55. As the game system, I want the timer to be server-authoritative (stored as `timer_started_at`) so that clients can't cheat by pausing local timers.
56. As a player, I want my local countdown timer to be cosmetic only, derived from `timer_started_at` so that timer drift doesn't affect game outcomes.
57. As the game system, I want all Ably channels to be scoped to the room so that events from other rooms don't bleed through.

---

## Implementation Decisions

### Modules

**1. Room & Lobby Module**
- Creates rooms with a generated 6-char code; assigns creator as host.
- Manages player join, seat order assignment, and `is_connected` tracking.
- Exposes a real-time lobby state (player list, ready status).

**2. Prompt Engine**
- Serves 2–3 random prompts per player from the `prompts` table at round start.
- Tracks which prompt each player selected; does not reveal selections to other players.

**3. Chain Router**
- Deterministic function: given `(owner_seat, pass_number, player_count)` → `author_seat`.
- Even N: `(owner_seat + pass_number - 1) % N`
- Odd N: `(owner_seat + pass_number) % N`
- Generates `entries` rows with correct `author_player_id` assignments at round start.

**4. Round Lifecycle Manager**
- Transitions room status through `lobby → prompts → active → reveal → scoring → finished`.
- On round start: records `timer_started_at` in `rounds`.
- Advances `current_pass` when all entries for the pass are submitted OR timer expires.
- Handles multi-round game progression.

**5. Canvas / Drawing Module**
- Touch and mouse canvas on player phones (no React Native — web only).
- Brush size control; no color picker in v1.
- Serializes strokes as JSON path data (`{ points: [{x, y}][], brushSize: number }[]`).
- Sends serialized drawing to server on submit; re-renders drawings from stored JSON during reveal.

**6. Entry Submission Service**
- Accepts drawing (JSON) or guess (text) for the correct `book_id` and `pass_number`.
- Validates the submitting player is the correct author per chain routing.
- Sets `submitted_at`; for guesses, computes `fuzzy_correct` against previous entry's original prompt (competitive mode).
- Marks `is_blank = true` for disconnected players on round advance.

**7. Fuzzy Match Service**
- Computes string similarity between a guess and a reference string (e.g., Levenshtein or Jaro-Winkler).
- Returns boolean `fuzzy_correct` stored on the entry.
- Pure function; easily testable in isolation.

**8. Reveal Engine**
- Tracks `reveal_book_index` and `reveal_entry_index` on the `rooms` row.
- Host advances via an Ably channel event (from TV or phone).
- Broadcasts reveal state; player phones highlight their own entry.

**9. Voting & Scoring Module**
- Friendly: collects `votes` rows; tallies into `scores` after all books revealed.
- Competitive: reads `fuzzy_correct` / `owner_override` from entries; writes `scores` rows with appropriate `reason` values.
- Final leaderboard aggregates `scores` per player.

**10. Host Screen UI**
- Separate route/page for the TV browser (`/room/[code]/host`).
- Subscribes to the same Ably channels as player phones.
- Shows large-format lobby, timer + pending list during active play, and cinematic reveal.

### Schema (as designed — no changes)

Tables: `rooms`, `players`, `rounds`, `books`, `entries`, `prompts`, `scores`, `votes` — see `docs/decisions.md` for full column definitions.

### API Contracts

- Room creation: `POST /api/rooms` → `{ roomCode, playerId }`
- Join room: `POST /api/rooms/[code]/join` → `{ playerId }`
- Start game: `POST /api/rooms/[code]/start`
- Select prompt: `POST /api/rounds/[id]/prompt`
- Submit entry: `POST /api/entries` → `{ bookId, passNumber, type, content }`
- Advance reveal: `POST /api/rooms/[code]/reveal/advance`
- Submit vote: `POST /api/votes`
- Override correctness: `PATCH /api/entries/[id]/override`

### Realtime Events (Ably channels, scoped per room)

- `room:status` — status transitions
- `room:players` — join/disconnect/seat updates
- `round:timer` — timer start broadcast
- `round:pass` — pass number advance
- `reveal:advance` — book/entry index update

---

## Testing Decisions

**What makes a good test:** Tests should verify external behavior observable by a caller — return values, state changes in the DB, or events emitted. Do not test internal implementation details like which helper functions were called. Tests should be runnable without UI.

**Modules to test:**

| Module | Test focus |
|---|---|
| Chain Router | Pure function — given `(owner_seat, pass_number, N)`, verify correct `author_seat` for both even and odd N, including edge cases (seat 0, seat N−1, all pass numbers) |
| Fuzzy Match Service | Pure function — correct/incorrect verdicts for exact matches, near-matches, completely wrong strings, case/whitespace variations |
| Entry Submission Service | Integration — submitting a valid drawing advances pass; submitting as the wrong author is rejected; timer expiry blanks missing entries |
| Round Lifecycle Manager | Integration — round advances at full submission; round advances at timer expiry; multi-round game reaches `finished` status |
| Scoring Module | Integration — friendly vote tallies correctly; competitive scores assign points to correct guesser and their artist; owner override changes score outcome |
| Reveal Engine | Integration — `reveal_book_index` and `reveal_entry_index` increment correctly; wraps at end of book; wraps at end of all books |

No UI or canvas tests in v1.

---

## Out of Scope

- Drawing enhancements: color picker, eraser, undo (deferred)
- Custom word entry by host (deferred)
- Configurable timer duration (currently fixed at 60s)
- Persistent accounts or game history
- Mobile app (native iOS/Android)
- Spectator mode
- Reconnection with full state restore (disconnected player's slot becomes blank)
- Prompt categories or filtering

---

## Further Notes

- The 6-char room code should be human-readable (avoid confusing characters like 0/O, 1/I/l). Uppercase alpha only is a reasonable choice.
- Seat order should be assigned at join time and remain stable; it drives all chain routing math.
- The "host screen" route should be accessible by anyone in the room navigating to it (no separate host auth), but only the designated host player can trigger host actions.
- Drawing JSON stored in the `content` column of `entries` should be validated for size limits on submission to prevent abuse.
- Ably free tier (200 concurrent connections, 6M messages/month) and Neon free tier (unlimited projects, 0.5GB storage) together cover party-game scale and were deliberate vendor choices.

# Telestrations: Design Decisions

Decisions made during design session on 2026-03-18.

---

## Architecture

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js | Existing preference |
| Database | Neon + Drizzle ORM | Serverless Postgres, unlimited free projects; Drizzle schema-as-code eliminates the manual types.ts/migration split |
| Realtime | Ably | 6M messages/month free, 200 concurrent connections; channel-scoping model is identical to what was planned for Supabase Realtime |
| Deployment | Internet-hosted | Players join via room code at a public URL; no LAN required |
| Device model | Host screen + player phones | Host screen on TV/laptop (browser); each player uses their own phone to draw/guess |

---

## Room & Lobby

| Decision | Choice |
|---|---|
| Auth | Ephemeral — nickname only, no accounts, no persistence after game ends |
| Room creation | Any player can create a room; creator becomes host |
| Join method | 6-character room code |
| Host powers | Start game, advance reveal, control game flow from either their phone or the host screen (TV) |
| Host two-device flow | Host creates room on laptop (TV screen) → phone scans QR to connect as same player → phone shows player view + inline host controls |

---

## Host Two-Device Flow

The host is both the TV operator and a full player. They need two connected sessions:

**Laptop/TV** → `POST /api/rooms` → navigates to `/room/{code}/host` directly (no redirect needed from player page).

**Phone** → scans QR code shown on host screen → hits `GET /room/{code}/connect?pid={playerId}` → server sets `playerId` cookie → redirects to `/room/{code}` → player view with inline host controls.

Key decisions:
- The `playerId` UUID is embedded directly in the QR URL (no separate token table). Acceptable for an ephemeral party game played in a shared physical space.
- `/room/{code}` is the universal **player view**. It no longer auto-redirects to `/room/{code}/host` — the host screen is accessed by direct navigation only.
- When `playerId === hostPlayerId`, the player view renders an extra "Host Controls" section (start game, advance reveal) in addition to the normal drawing/guessing UI.
- The connect route is stateless — it only sets a cookie and redirects. No DB write needed.

---

## Players & Game Setup

| Decision | Choice |
|---|---|
| Player count | 4–12 (full range) |
| Odd player handling | Supported — chain length = N−1 for odd N; owner writes word but does not draw; book passed to left neighbor first; last entry always a guess |
| Rounds | Host-configured (not fixed at 3) |
| Prompts | Player chooses from 2–3 options at round start (not random auto-assign) |

---

## Gameplay

| Decision | Choice |
|---|---|
| Drawing style | Simultaneous — all players draw at the same time |
| Timer | 60 seconds, server-authoritative (`timer_started_at` stored in DB; local timer is cosmetic only) |
| Early submission | Player waits silently on a "waiting for others" screen |
| Round advances when | All players have submitted OR timer expires |
| Disconnection | Game continues; disconnected player's slot becomes a blank entry |
| Drawing tool | Simple finger/mouse canvas for now (brush size, no color picker initially) |
| Drawing storage | JSON path data (array of strokes/points) — compact, re-renderable, easy to replay |

---

## Chain Routing

The core data structure is a chain of alternating drawings and guesses per "book" (one book per player per round).

**Even N players:**
- Chain length = N entries
- Owner draws entry 1 (their own word)
- Entry P authored by seat `(owner_seat + P - 1) % N`
- Last entry (P = N, even) is a guess ✓

**Odd N players:**
- Chain length = N−1 entries
- Owner writes word but does NOT draw; book is passed to left neighbor first
- Entry P authored by seat `(owner_seat + P) % N`
- Owner reveals the book but does not add a final entry
- Last entry (P = N−1, even) is a guess ✓

---

## Host Screen

| Phase | What host screen shows |
|---|---|
| Lobby | Player list, room code, start button |
| Active play | Countdown timer + names of players who haven't submitted yet |
| Reveal | Cinematic chain flip — one book at a time, host advances manually |

The host can advance the reveal from either:
- The TV browser (keyboard/click)
- Their player phone (host controls section)

Both publish to the same Ably channel.

---

## Reveal Flow

- Books revealed one at a time (not all simultaneously)
- Host manually advances through each entry in the chain
- Player phones show the chain entry they personally contributed, highlighted in context
- `reveal_book_index` and `reveal_entry_index` tracked in `rooms` table

---

## Scoring

| Decision | Choice |
|---|---|
| Modes | Full implementation: both friendly and competitive |
| Correctness | Fuzzy string match computed on submission; book owner can override (mark correct/incorrect) |
| Friendly scoring | Players vote for favorite sketch and favorite guess per book after reveal |
| Competitive scoring | Points for correct guess + points for drawing that led to a correct guess |

---

## Data Model

### `rooms`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| code | text UNIQUE | 6-char join code |
| status | enum | `lobby \| prompts \| active \| reveal \| scoring \| finished` |
| host_player_id | uuid FK→players | |
| num_rounds | int | host-configured |
| current_round | int | |
| scoring_mode | enum | `friendly \| competitive` |
| reveal_book_index | int | which book is being revealed |
| reveal_entry_index | int | which entry within that book |
| created_at | timestamp | |

### `players`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| room_id | uuid FK→rooms | |
| nickname | text | |
| seat_order | int | determines chain routing |
| is_connected | bool | |
| created_at | timestamp | |

### `rounds`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| room_id | uuid FK→rooms | |
| round_number | int | |
| current_pass | int | which pass is active, 1-indexed |
| timer_started_at | timestamp | server-authoritative |

### `books`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid FK→rounds | |
| owner_player_id | uuid FK→players | |
| original_prompt | text | |

### `entries`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| book_id | uuid FK→books | |
| pass_number | int | 1-indexed |
| author_player_id | uuid FK→players | |
| type | enum | `drawing \| guess` |
| content | text | JSON path data for drawings; plain text for guesses |
| submitted_at | timestamp | |
| is_blank | bool | true if player was disconnected |
| fuzzy_correct | bool | computed on submit |
| owner_override | bool | null=no override, true=correct, false=incorrect |

### `prompts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| text | text | |
| category | text | optional |

### `scores`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| room_id | uuid FK→rooms | |
| round_id | uuid FK→rounds | |
| player_id | uuid FK→players | |
| points | int | |
| reason | enum | `correct_guess \| aided_correct \| favorite_sketch \| favorite_guess \| chain_survived` |

### `votes` *(friendly mode only)*
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| book_id | uuid FK→books | |
| voter_player_id | uuid FK→players | |
| entry_id | uuid FK→entries | |
| vote_type | enum | `favorite_sketch \| favorite_guess` |

---

## Open Questions / Future Work

- Drawing tool enhancements (color picker, eraser, undo) — deferred
- Additional prompt categories or custom word entry by host — deferred
- Timer duration configurable by host (currently fixed at 60s) — not decided

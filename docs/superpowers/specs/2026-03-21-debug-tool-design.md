# Debug Tool Design — Issue #27

**Date:** 2026-03-21
**Status:** Reviewed
**GitHub Issue:** [#27](https://github.com/mdeforest/Telestrations/issues/27)

---

## Overview

A developer debug tool at `/debug` that allows a single developer to:
- Create a room with 4–6 simulated players in one click
- See a state-level dashboard of every player's current screen/phase
- Trigger game actions (start, submit prompts, submit drawings, submit guesses, advance reveal) on behalf of all players
- Rapidly iterate through full game flows for testing without needing multiple real browsers

**Environment:** Dev/local only. The route and all API endpoints return `notFound()` / 404 when `process.env.NODE_ENV === 'production'`.

---

## Architecture

### Approach: State Dashboard + Server-Side Action API

The debug tool manages a "debug session" server-side. It stores player IDs in memory (attached to `globalThis` to survive Next.js hot-reloads), calls existing service functions directly (bypassing HTTP/cookie auth), and exposes a lightweight polling API for the dashboard.

This avoids cookie-per-iframe hacks and does not touch the auth layer.

### Components

```
src/
  lib/
    debug/
      debug-service.ts        # Core session management + action execution
  app/
    api/
      debug/
        session/
          route.ts            # POST /api/debug/session  (create session)
          [id]/
            route.ts          # GET /api/debug/session/[id]  (get state)
            action/
              route.ts        # POST /api/debug/session/[id]/action  (perform action)
    debug/
      page.tsx                # Dev-only Next.js page (calls notFound() in production)
      DebugDashboard.tsx      # Client component: player cards + action panel
```

Tests are co-located in `__tests__` directories following existing project conventions.

---

## Data Model

### DebugSession (in-memory, keyed by UUID)

```typescript
interface DebugSession {
  id: string;           // UUID
  roomCode: string;
  roomId: string;
  players: DebugPlayer[];
  createdAt: Date;
}

interface DebugPlayer {
  playerId: string;
  nickname: string;
  seatOrder: number;
  isHost: boolean;
}
```

### Hot-reload survival pattern

Sessions live in a `Map` attached to `globalThis` so they survive Next.js dev-mode hot reloads:

```typescript
const sessions: Map<string, DebugSession> =
  ((globalThis as Record<string, unknown>).__debugSessions__ as Map<string, DebugSession>)
  ?? new Map();
(globalThis as Record<string, unknown>).__debugSessions__ = sessions;
```

---

## API

### POST `/api/debug/session`

Creates a room and N players, stores the session.

**Request:**
```json
{ "playerCount": 4 }
```

`playerCount` must be **4–6** (minimum 4 is enforced by `startGame` which throws `InsufficientPlayersError` for fewer than 4 players).

**Response (201):**
```json
{
  "sessionId": "uuid",
  "roomCode": "ABCDE",
  "players": [
    { "playerId": "uuid", "nickname": "Player 1", "seatOrder": 0, "isHost": true },
    ...
  ]
}
```

**Implementation:** Inserts room + players directly via Drizzle (same pattern as existing `createRoom` / `joinRoom` services). Generates nicknames `Player 1`, `Player 2`, etc.

---

### GET `/api/debug/session/[id]`

Returns current room state + each player's computed screen.

**Response (200):**
```json
{
  "sessionId": "uuid",
  "roomCode": "ABCDE",
  "roomStatus": "active",
  "currentRound": 1,
  "numRounds": 3,
  "players": [
    {
      "playerId": "uuid",
      "nickname": "Player 1",
      "isHost": true,
      "screen": "DrawingPhase"
    },
    ...
  ]
}
```

**`screen` derivation** (all players are in the same phase):

| `room.status` | `screen` |
|---|---|
| `lobby` | `Lobby` |
| `prompts` | `PromptSelection` |
| `active`, pass is drawing | `DrawingPhase` |
| `active`, pass is guess | `GuessingPhase` |
| `reveal` | `Reveal` |
| `scoring` | `Finished` |
| `finished` | `Finished` |

For `active` status, read `currentPass` from the round matching `room.currentRound`. Pass type follows the same rule as `src/lib/game/chain-router.ts` `entryType`: pass 1 = drawing, pass 2 = guess, alternating (odd = drawing, even = guess).

---

### POST `/api/debug/session/[id]/action`

Performs a game action on behalf of all players.

**Request:**
```json
{
  "action": "start_game" | "submit_all_prompts" | "submit_all_drawings" | "submit_all_guesses" | "advance_reveal"
}
```

`targetPlayerId` is **not supported in MVP**. All bulk actions operate on all players; `advance_reveal` always uses the host.

**Response (200):**
```json
{ "ok": true }
```

**Error responses:**
- `404` — unknown session ID
- `400` — invalid action or wrong phase

---

## DebugService

`src/lib/debug/debug-service.ts` — factory function receiving `db`:

```typescript
export function createDebugService(db: DB) { ... }
```

### Methods

**`createSession(playerCount: number): Promise<DebugSession>`**
- Validates `playerCount` is 4–6; throws `DebugInvalidConfigError` otherwise
- Inserts room (`status: 'lobby'`) + N players via Drizzle
- Player 0 is the host (`seatOrder: 0`, stored in `rooms.hostPlayerId`)
- Stores session in the `globalThis` Map
- Returns the `DebugSession`

**`getSessionState(sessionId: string): Promise<DebugSessionState>`**
- Throws `DebugSessionNotFoundError` for unknown `sessionId`
- Reads room from DB, reads current round if status is `active`/`prompts`
- Derives each player's `screen` using the table above
- Returns `DebugSessionState`

**`performAction(sessionId: string, action: DebugAction): Promise<void>`**
- Throws `DebugSessionNotFoundError` for unknown session
- Throws `DebugInvalidActionError` when action doesn't apply to current phase
- Dispatches to action handlers below

### Action Handlers

**`start_game`**
- Calls `createRoomService(db).startGame(roomCode, hostPlayerId, { numRounds: 3, scoringMode: 'friendly' })`
- Valid only in `lobby` phase

**`submit_all_prompts`**
- Valid only in `prompts` phase
- For each player: calls `createRoomService(db).selectPrompt(roundId, playerId, promptId)`
- Obtains `promptId` by calling `createRoundsService(db).getPromptOptions(roundId, playerId)` and picking the first result
- If `getPromptOptions` returns an empty array (prompts table not seeded), inserts a sentinel prompt `{ text: '__debug_prompt__', category: 'debug' }` into the `prompts` table and uses its ID
- The round ID is fetched internally from the DB using `room.currentRound`

**`submit_all_drawings`**
- Valid only when `screen` is `DrawingPhase`
- For each player: calls `createEntryService(db).submitEntry({ bookId, passNumber, authorPlayerId, type: 'drawing', content: '[]' })`
- Book/pass looked up from DB for each player

**`submit_all_guesses`**
- Valid only when `screen` is `GuessingPhase`
- For each player: calls `createEntryService(db).submitEntry({ bookId, passNumber, authorPlayerId, type: 'guess', content: 'debug guess' })`

**`advance_reveal`**
- Valid only in `reveal` phase
- Looks up host player: `session.players.find(p => p.isHost)!.playerId`
- Calls `createRevealService(db).advanceReveal(roomCode, hostPlayerId)`

---

## Dashboard UI

`src/app/debug/page.tsx`:
- Server component
- Calls `notFound()` if `process.env.NODE_ENV === 'production'`
- Otherwise renders `<DebugDashboard />`

`src/app/debug/DebugDashboard.tsx` (client component):

```
┌─────────────────────────────────────────────────────────┐
│  🛠 Debug Dashboard                     [New Session ▸]  │
├─────────────────────────────────────────────────────────┤
│  Room: ABCDE │ Phase: DrawingPhase │ Round: 1/3         │
├─────────────────────────────────────────────────────────┤
│  Player 1 (Host)  │  Player 2  │  Player 3  │ Player 4  │
│  DrawingPhase     │ DrawingPhase│ Drawing... │ Drawing   │
├─────────────────────────────────────────────────────────┤
│  [Start Game] [Submit All Prompts] [Submit All Drawings] │
│  [Submit All Guesses] [Advance Reveal]                   │
└─────────────────────────────────────────────────────────┘
```

- "New Session" button with a player count selector (4–6) → POST `/api/debug/session`
- Polls `GET /api/debug/session/[id]` every 2 seconds after session is created
- Action buttons POST to `/api/debug/session/[id]/action`
- Buttons disabled when the action doesn't apply to current phase (e.g. `start_game` disabled after game has started)

---

## Testing Strategy

All tests use Vitest. Service tests mock `@/lib/db`; route tests mock the service.

### DebugService unit tests (`src/lib/debug/__tests__/debug-service.test.ts`)

- `createSession(4)` inserts 1 room + 4 players, returns session with correct structure
- `createSession(3)` throws `DebugInvalidConfigError`
- `createSession(7)` throws `DebugInvalidConfigError`
- `getSessionState` returns `screen: 'Lobby'` for `status: 'lobby'`
- `getSessionState` returns `screen: 'PromptSelection'` for `status: 'prompts'`
- `getSessionState` returns `screen: 'DrawingPhase'` for `status: 'active'`, `currentPass: 1`
- `getSessionState` returns `screen: 'GuessingPhase'` for `status: 'active'`, `currentPass: 2`
- `getSessionState` returns `screen: 'Reveal'` for `status: 'reveal'`
- `getSessionState` returns `screen: 'Finished'` for `status: 'finished'`
- `getSessionState` throws `DebugSessionNotFoundError` for unknown ID
- `performAction('start_game')` calls `startGame` with `numRounds: 3, scoringMode: 'friendly'`
- `performAction('start_game')` throws `DebugInvalidActionError` when status is not `lobby`
- `performAction('submit_all_prompts')` calls `selectPrompt` for each player
- `performAction('submit_all_prompts')` inserts sentinel prompt when prompts table empty
- `performAction('submit_all_drawings')` calls `submitEntry` with `type: 'drawing'` for each player
- `performAction('submit_all_guesses')` calls `submitEntry` with `type: 'guess'` for each player
- `performAction('advance_reveal')` calls `advanceReveal` with the host's player ID
- `performAction('advance_reveal')` throws `DebugInvalidActionError` when status is not `reveal`
- `performAction` with unknown `sessionId` throws `DebugSessionNotFoundError`

### API route tests

- `POST /api/debug/session` with `{ playerCount: 4 }` → 201 with session
- `POST /api/debug/session` with `{ playerCount: 3 }` → 400
- `GET /api/debug/session/[id]` → 200 with session state
- `GET /api/debug/session/unknown` → 404
- `POST /api/debug/session/[id]/action` with `{ action: 'start_game' }` → 200
- `POST /api/debug/session/[id]/action` with unknown session → 404
- `POST /api/debug/session/[id]/action` with wrong-phase action → 400
- All routes return 404 when `NODE_ENV === 'production'`

---

## Security / Guardrails

- All API routes and the page check `process.env.NODE_ENV === 'production'` and call `notFound()` / return 404 otherwise
- No authentication — any local dev request can use the debug tool
- Sessions are ephemeral — no persistent debug data in the DB beyond the rooms/players created

---

## Out of Scope (MVP)

- Per-player single-action targeting
- Persistent sessions across server restarts (only across hot-reloads via `globalThis`)
- Full iframe rendering of player UIs
- Scoring/voting actions
- Custom nicknames / room codes
- Replay/history log
- Ably-based real-time dashboard updates (polling only for now)

---

## Extensibility Notes

New actions: add to `DebugAction` union → implement handler in `DebugService` → add button in `DebugDashboard`.

Session store can be swapped from `globalThis` Map to Redis/DB with no API shape changes.

Polling can be replaced with Ably subscription on a `debug:session:[id]` channel in a future iteration, consistent with the existing realtime architecture.

# Debug Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dev-only debug dashboard at `/debug` that creates rooms with simulated players and drives them through a full game flow via action buttons.

**Architecture:** `DebugService` (factory function, takes `db`) manages in-memory sessions via a `globalThis` Map and calls existing service factories directly. Three API routes (`/api/debug/session`, `/api/debug/session/[id]`, `/api/debug/session/[id]/action`) expose a polling REST interface. A client-side React dashboard polls state every 2 seconds and dispatches actions.

**Tech Stack:** Next.js App Router, Drizzle ORM (neon-http), Vitest, `@testing-library/react`, TypeScript

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `src/lib/debug/debug-service.ts` | Create | Session store, createSession, getSessionState, performAction |
| `src/lib/debug/__tests__/debug-service.test.ts` | Create | Unit tests for DebugService (mock DB) |
| `src/app/api/debug/session/route.ts` | Create | POST create session |
| `src/app/api/debug/session/__tests__/route.test.ts` | Create | Route tests |
| `src/app/api/debug/session/[id]/route.ts` | Create | GET session state |
| `src/app/api/debug/session/[id]/__tests__/route.test.ts` | Create | Route tests |
| `src/app/api/debug/session/[id]/action/route.ts` | Create | POST perform action |
| `src/app/api/debug/session/[id]/action/__tests__/route.test.ts` | Create | Route tests |
| `src/app/debug/page.tsx` | Create | Server page: dev-only guard, renders DebugDashboard |
| `src/app/debug/DebugDashboard.tsx` | Create | Client component: player cards + action panel |

---

## Reference: Key Existing Service Signatures

```typescript
// src/lib/rooms/service.ts
createRoomService(db).startGame(code, hostPlayerId, { numRounds: 3, scoringMode: 'friendly' })

// src/lib/game/prompt-service.ts
createPromptService(db).getPromptOptions(roundId, playerId)
  // returns { options: Array<{ id: string; text: string }>, alreadySelected: boolean }
createPromptService(db).selectPrompt(roundId, playerId, promptId)

// src/lib/game/entry-service.ts
createEntryService(db).submitEntry(bookId, passNumber, playerId, content)
  // returns { allSubmitted: boolean, roundComplete: boolean }

// src/lib/game/reveal-service.ts
createRevealService(db).advanceReveal(code, playerId)

// src/lib/game/chain-router.ts
entryType(passNumber) // → "drawing" | "guess"  (1-indexed, odd=drawing)
```

## Reference: DB Schema (relevant tables)

```typescript
// rooms: id, code, status, hostPlayerId, numRounds, currentRound, revealBookIndex, revealEntryIndex
// players: id, roomId, nickname, seatOrder
// rounds: id, roomId, roundNumber, currentPass, timerStartedAt
// books: id, roundId, ownerPlayerId, originalPrompt
// entries: id, bookId, passNumber, authorPlayerId, type, content, submittedAt
// prompts: id, text, category
```

## Reference: Test Patterns

**Service unit test mock pattern (see entry-service.test.ts):**
```typescript
function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const resp = responses[callIdx++] ?? [];
        const thenable = Promise.resolve(resp);
        return thenable;
      }),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(responses[callIdx++] ?? [])),
      }),
    }),
  }));
}
```

**Route test pattern (see reveal/advance/__tests__/route.test.ts):**
```typescript
const mocks = vi.hoisted(() => ({ myFn: vi.fn() }));
vi.mock("@/lib/game/my-service", () => ({
  createMyService: () => ({ myFn: mocks.myFn }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
// Import route AFTER mocks
import { POST } from "../route";
```

**Run tests:** `npx vitest run src/lib/debug --reporter=verbose`

---

## Task 1: DebugService — error types and session store

**Files:**
- Create: `src/lib/debug/debug-service.ts`
- Create: `src/lib/debug/__tests__/debug-service.test.ts`

- [ ] **Step 1.1: Write failing test for unknown session error**

```typescript
// src/lib/debug/__tests__/debug-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { createDebugService, DebugSessionNotFoundError, DebugInvalidConfigError } from "../debug-service";

describe("createDebugService", () => {
  it("getSessionState throws DebugSessionNotFoundError for unknown id", async () => {
    const db = {} as any;
    const service = createDebugService(db);
    await expect(service.getSessionState("nonexistent")).rejects.toThrow(DebugSessionNotFoundError);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: FAIL — module not found or missing exports.

- [ ] **Step 1.3: Write minimal debug-service skeleton**

```typescript
// src/lib/debug/debug-service.ts

// ── Error types ──────────────────────────────────────────────────────────────

export class DebugSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Debug session not found: ${sessionId}`);
    this.name = "DebugSessionNotFoundError";
  }
}

export class DebugInvalidConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DebugInvalidConfigError";
  }
}

export class DebugInvalidActionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DebugInvalidActionError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DebugPlayer {
  playerId: string;
  nickname: string;
  seatOrder: number;
  isHost: boolean;
}

export interface DebugSession {
  id: string;
  roomCode: string;
  roomId: string;
  players: DebugPlayer[];
  createdAt: Date;
}

export type DebugAction =
  | "start_game"
  | "submit_all_prompts"
  | "submit_all_drawings"
  | "submit_all_guesses"
  | "advance_reveal";

export interface DebugPlayerState {
  playerId: string;
  nickname: string;
  isHost: boolean;
  screen: "Lobby" | "PromptSelection" | "DrawingPhase" | "GuessingPhase" | "Reveal" | "Finished";
}

export interface DebugSessionState {
  sessionId: string;
  roomCode: string;
  roomStatus: string;
  currentRound: number;
  numRounds: number;
  players: DebugPlayerState[];
}

// ── Session store (survives Next.js hot-reloads) ──────────────────────────────

const sessions: Map<string, DebugSession> =
  ((globalThis as Record<string, unknown>).__debugSessions__ as Map<string, DebugSession>) ??
  new Map();
(globalThis as Record<string, unknown>).__debugSessions__ = sessions;

// ── Service factory ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDebugService(db: any) {
  function getSession(sessionId: string): DebugSession {
    const session = sessions.get(sessionId);
    if (!session) throw new DebugSessionNotFoundError(sessionId);
    return session;
  }

  async function getSessionState(sessionId: string): Promise<DebugSessionState> {
    getSession(sessionId); // throws if missing
    throw new Error("not implemented");
  }

  async function createSession(_playerCount: number): Promise<DebugSession> {
    throw new Error("not implemented");
  }

  async function performAction(_sessionId: string, _action: DebugAction): Promise<void> {
    throw new Error("not implemented");
  }

  return { createSession, getSessionState, performAction, getSession };
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: PASS (1 test).

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/debug/debug-service.ts src/lib/debug/__tests__/debug-service.test.ts
git commit -m "feat(debug): scaffold DebugService with error types and session store"
```

---

## Task 2: DebugService — createSession

**Files:**
- Modify: `src/lib/debug/debug-service.ts`
- Modify: `src/lib/debug/__tests__/debug-service.test.ts`

- [ ] **Step 2.1: Write failing tests for createSession**

Add to the test file (inside the same `describe` block):

```typescript
import { v4 as uuidv4 } from "uuid";

// Add mock helpers at top of file:
function makeInsertMock(returnVal: Record<string, unknown>) {
  return vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([returnVal]),
    }),
  });
}

function makeUpdateMock() {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });
}

describe("createSession", () => {
  it("throws DebugInvalidConfigError when playerCount < 4", async () => {
    const db = {} as any;
    const service = createDebugService(db);
    await expect(service.createSession(3)).rejects.toThrow(DebugInvalidConfigError);
  });

  it("throws DebugInvalidConfigError when playerCount > 6", async () => {
    const db = {} as any;
    const service = createDebugService(db);
    await expect(service.createSession(7)).rejects.toThrow(DebugInvalidConfigError);
  });

  it("creates session with 4 players and stores it in the session map", async () => {
    const roomId = "room-id-1";
    const db = {
      insert: vi.fn()
        // First call: insert room
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: roomId, code: "ABCDE" }]),
          }),
        })
        // Subsequent calls: insert each player (4 times)
        .mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "p-id", seatOrder: 0 }]),
          }),
        }),
      update: makeUpdateMock(),
    } as any;

    const service = createDebugService(db);
    const session = await service.createSession(4);

    expect(session.roomCode).toBe("ABCDE");
    expect(session.players).toHaveLength(4);
    expect(session.players[0].isHost).toBe(true);
    expect(session.players[1].isHost).toBe(false);
    expect(service.getSession(session.id)).toBe(session);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: FAIL — "not implemented".

- [ ] **Step 2.3: Implement createSession**

Replace the `createSession` stub in `debug-service.ts`:

```typescript
import { rooms, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// Add at top of factory function:
async function createSession(playerCount: number): Promise<DebugSession> {
  if (playerCount < 4 || playerCount > 6) {
    throw new DebugInvalidConfigError(`playerCount must be 4–6, got ${playerCount}`);
  }

  // Generate a short room code
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const roomCode = Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join("");

  // Insert room
  const [room] = await db
    .insert(rooms)
    .values({ code: roomCode })
    .returning();

  // Insert players
  const createdPlayers: DebugPlayer[] = [];
  for (let i = 0; i < playerCount; i++) {
    const nickname = `Player ${i + 1}`;
    const [player] = await db
      .insert(players)
      .values({ roomId: room.id, nickname, seatOrder: i })
      .returning();
    createdPlayers.push({
      playerId: player.id,
      nickname,
      seatOrder: i,
      isHost: i === 0,
    });
  }

  // Assign host
  await db
    .update(rooms)
    .set({ hostPlayerId: createdPlayers[0].playerId })
    .where(eq(rooms.id, room.id));

  const session: DebugSession = {
    id: randomUUID(),
    roomCode: room.code,
    roomId: room.id,
    players: createdPlayers,
    createdAt: new Date(),
  };

  sessions.set(session.id, session);
  return session;
}
```

Also add `import { rooms, players } from "@/lib/db/schema"` and `import { eq } from "drizzle-orm"` and `import { randomUUID } from "crypto"` at the top of the file.

- [ ] **Step 2.4: Run tests to verify they pass**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: PASS (all 4 tests).

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/debug/debug-service.ts src/lib/debug/__tests__/debug-service.test.ts
git commit -m "feat(debug): implement createSession with player count validation"
```

---

## Task 3: DebugService — getSessionState (screen derivation)

**Files:**
- Modify: `src/lib/debug/debug-service.ts`
- Modify: `src/lib/debug/__tests__/debug-service.test.ts`

- [ ] **Step 3.1: Write failing tests for getSessionState**

Add to the test file. First add a helper to pre-populate the session store:

```typescript
import { createDebugService, DebugSession, /* ... */ } from "../debug-service";

// Helper: inject a fake session directly into the store
function seedSession(service: ReturnType<typeof createDebugService>, session: DebugSession) {
  // Access internal store via getSession to verify — inject via createSession mock instead
  (globalThis as any).__debugSessions__.set(session.id, session);
}

const BASE_SESSION: DebugSession = {
  id: "sess-1",
  roomCode: "ABCDE",
  roomId: "room-1",
  players: [
    { playerId: "p1", nickname: "Player 1", seatOrder: 0, isHost: true },
    { playerId: "p2", nickname: "Player 2", seatOrder: 1, isHost: false },
    { playerId: "p3", nickname: "Player 3", seatOrder: 2, isHost: false },
    { playerId: "p4", nickname: "Player 4", seatOrder: 3, isHost: false },
  ],
  createdAt: new Date(),
};

describe("getSessionState", () => {
  // Each test seeds the session directly into globalThis.__debugSessions__
  // and builds a db mock returning the appropriate room state.

  it("returns Lobby screen when room status is lobby", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "lobby", currentRound: 0, numRounds: 3 };
    const db = {
      select: makeSelectSequence([
        [roomRow], // room lookup
      ]),
    } as any;
    const service = createDebugService(db);
    seedSession(service, BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.roomStatus).toBe("lobby");
    expect(state.players[0].screen).toBe("Lobby");
  });

  it("returns PromptSelection screen when room status is prompts", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "prompts", currentRound: 1, numRounds: 3 };
    const db = {
      select: makeSelectSequence([
        [roomRow],  // room lookup
        [],         // round lookup (not needed for screen derivation here)
      ]),
    } as any;
    const service = createDebugService(db);
    seedSession(service, BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.players[0].screen).toBe("PromptSelection");
  });

  it("returns DrawingPhase when status is active and currentPass is 1 (odd)", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = {
      select: makeSelectSequence([[roomRow], [roundRow]]),
    } as any;
    const service = createDebugService(db);
    seedSession(service, BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.players[0].screen).toBe("DrawingPhase");
  });

  it("returns GuessingPhase when status is active and currentPass is 2 (even)", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 2 };
    const db = {
      select: makeSelectSequence([[roomRow], [roundRow]]),
    } as any;
    const service = createDebugService(db);
    seedSession(service, BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.players[0].screen).toBe("GuessingPhase");
  });

  it("returns Reveal screen when status is reveal", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "reveal", currentRound: 3, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as any;
    const service = createDebugService(db);
    seedSession(service, BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.players[0].screen).toBe("Reveal");
  });

  it("returns Finished screen when status is finished", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "finished", currentRound: 3, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as any;
    const service = createDebugService(db);
    seedSession(service, BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.players[0].screen).toBe("Finished");
  });
});
```

Note: `makeSelectSequence` is defined in Task 1's test file — place it at the top of the file.

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: FAIL — "not implemented".

- [ ] **Step 3.3: Implement getSessionState**

Replace the `getSessionState` stub:

```typescript
import { entryType } from "@/lib/game/chain-router";
import { rooms, rounds } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

async function getSessionState(sessionId: string): Promise<DebugSessionState> {
  const session = getSession(sessionId);

  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, session.roomId));

  let currentPass = 1;
  if (room.status === "active" || room.status === "prompts") {
    const [round] = await db
      .select()
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, Math.max(room.currentRound, 1))));
    if (round) currentPass = round.currentPass;
  }

  function deriveScreen(status: string, pass: number): DebugPlayerState["screen"] {
    switch (status) {
      case "lobby": return "Lobby";
      case "prompts": return "PromptSelection";
      case "active": return entryType(pass) === "drawing" ? "DrawingPhase" : "GuessingPhase";
      case "reveal": return "Reveal";
      case "scoring":
      case "finished": return "Finished";
      default: return "Lobby";
    }
  }

  const screen = deriveScreen(room.status, currentPass);

  return {
    sessionId: session.id,
    roomCode: session.roomCode,
    roomStatus: room.status,
    currentRound: room.currentRound,
    numRounds: room.numRounds,
    players: session.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isHost: p.isHost,
      screen,
    })),
  };
}
```

Add `import { and, eq } from "drizzle-orm"` and `import { entryType } from "@/lib/game/chain-router"` and `import { rooms, rounds } from "@/lib/db/schema"` at top (merge with existing imports).

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/debug/debug-service.ts src/lib/debug/__tests__/debug-service.test.ts
git commit -m "feat(debug): implement getSessionState with screen derivation"
```

---

## Task 4: DebugService — performAction (start_game + advance_reveal)

**Files:**
- Modify: `src/lib/debug/debug-service.ts`
- Modify: `src/lib/debug/__tests__/debug-service.test.ts`

- [ ] **Step 4.1: Write failing tests for performAction start_game and advance_reveal**

```typescript
describe("performAction", () => {
  it("throws DebugSessionNotFoundError for unknown session", async () => {
    const service = createDebugService({} as any);
    await expect(service.performAction("no-such-session", "start_game")).rejects.toThrow(
      DebugSessionNotFoundError
    );
  });

  it("start_game calls startGame with numRounds:3 scoringMode:friendly", async () => {
    const startGame = vi.fn().mockResolvedValue({});
    const db = { } as any;
    const service = createDebugService(db);
    // Inject mock for createRoomService
    (service as any).__mockRoomService = { startGame };
    seedSession(service, { ...BASE_SESSION, id: "sess-sg" });
    // We'll test via a spy on the module — instead, use dependency injection pattern
    // by passing createRoomServiceFn as a parameter. Since the service is a factory,
    // we need to inject it. See implementation note.
  });
});
```

**Implementation note:** To make `performAction` testable without hitting the real DB, pass optional service factory overrides to `createDebugService`:

```typescript
// Updated signature:
export function createDebugService(
  db: any,
  overrides?: {
    roomServiceFactory?: (db: any) => { startGame: (...args: any[]) => Promise<any> };
    revealServiceFactory?: (db: any) => { advanceReveal: (...args: any[]) => Promise<any> };
    entryServiceFactory?: (db: any) => { submitEntry: (...args: any[]) => Promise<any> };
    promptServiceFactory?: (db: any) => {
      getPromptOptions: (...args: any[]) => Promise<any>;
      selectPrompt: (...args: any[]) => Promise<any>;
    };
  }
)
```

Rewrite the tests using this pattern:

```typescript
describe("performAction", () => {
  it("throws DebugSessionNotFoundError for unknown session", async () => {
    const service = createDebugService({} as any);
    await expect(service.performAction("no-such-session", "start_game")).rejects.toThrow(
      DebugSessionNotFoundError
    );
  });

  it("start_game calls startGame with numRounds:3 scoringMode:friendly as host", async () => {
    const startGame = vi.fn().mockResolvedValue({});
    const service = createDebugService({} as any, {
      roomServiceFactory: () => ({ startGame }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-2" });
    await service.performAction("sess-2", "start_game");
    expect(startGame).toHaveBeenCalledWith("ABCDE", "p1", { numRounds: 3, scoringMode: "friendly" });
  });

  it("start_game throws DebugInvalidActionError when called in non-lobby room", async () => {
    const roomRow = { id: "room-1", status: "active", currentRound: 1, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as any;
    const service = createDebugService(db);
    seedSession(service, { ...BASE_SESSION, id: "sess-3" });
    await expect(service.performAction("sess-3", "start_game")).rejects.toThrow(
      DebugInvalidActionError
    );
  });

  it("advance_reveal calls advanceReveal with host playerId", async () => {
    const advanceReveal = vi.fn().mockResolvedValue({});
    const service = createDebugService({} as any, {
      revealServiceFactory: () => ({ advanceReveal }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-4" });
    await service.performAction("sess-4", "advance_reveal");
    expect(advanceReveal).toHaveBeenCalledWith("ABCDE", "p1");
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: FAIL.

- [ ] **Step 4.3: Update createDebugService signature and implement start_game + advance_reveal**

Update `debug-service.ts` to accept `overrides` and implement the two actions:

```typescript
import { createRoomService } from "@/lib/rooms/service";
import { createRevealService } from "@/lib/game/reveal-service";

export function createDebugService(
  db: any,
  overrides?: {
    roomServiceFactory?: typeof createRoomService;
    revealServiceFactory?: typeof createRevealService;
    // (entry and prompt factories added in Task 5)
  }
) {
  const roomSvc = (overrides?.roomServiceFactory ?? createRoomService)(db);
  const revealSvc = (overrides?.revealServiceFactory ?? createRevealService)(db);

  // ... existing getSession, createSession, getSessionState ...

  async function performAction(sessionId: string, action: DebugAction): Promise<void> {
    const session = getSession(sessionId);

    switch (action) {
      case "start_game": {
        // Verify room is in lobby phase first
        const [room] = await db.select().from(rooms).where(eq(rooms.id, session.roomId));
        if (room.status !== "lobby") {
          throw new DebugInvalidActionError(`start_game requires lobby status, got ${room.status}`);
        }
        const host = session.players.find((p) => p.isHost)!;
        await roomSvc.startGame(session.roomCode, host.playerId, {
          numRounds: 3,
          scoringMode: "friendly",
        });
        break;
      }
      case "advance_reveal": {
        const host = session.players.find((p) => p.isHost)!;
        await revealSvc.advanceReveal(session.roomCode, host.playerId);
        break;
      }
      default:
        throw new DebugInvalidActionError(`Unknown action: ${action}`);
    }
  }

  return { createSession, getSessionState, performAction, getSession };
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/debug/debug-service.ts src/lib/debug/__tests__/debug-service.test.ts
git commit -m "feat(debug): implement start_game and advance_reveal actions"
```

---

## Task 5: DebugService — submit_all_prompts, submit_all_drawings, submit_all_guesses

**Files:**
- Modify: `src/lib/debug/debug-service.ts`
- Modify: `src/lib/debug/__tests__/debug-service.test.ts`

- [ ] **Step 5.1: Write failing tests**

```typescript
describe("performAction - submit_all_prompts", () => {
  it("calls selectPrompt for each player using the first available prompt option", async () => {
    const getPromptOptions = vi.fn().mockResolvedValue({
      options: [{ id: "prompt-1", text: "A cat" }],
      alreadySelected: false,
    });
    const selectPrompt = vi.fn().mockResolvedValue({ allSelected: false });
    const roundRow = { id: "round-1", currentPass: 1 };
    const roomRow = { id: "room-1", status: "prompts", currentRound: 1, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as any;
    const service = createDebugService(db, {
      promptServiceFactory: () => ({ getPromptOptions, selectPrompt }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-p" });
    await service.performAction("sess-p", "submit_all_prompts");
    expect(getPromptOptions).toHaveBeenCalledTimes(4);
    expect(selectPrompt).toHaveBeenCalledTimes(4);
    expect(selectPrompt).toHaveBeenCalledWith("round-1", "p1", "prompt-1");
  });

  it("inserts a sentinel prompt when getPromptOptions returns empty options", async () => {
    const getPromptOptions = vi.fn().mockResolvedValue({ options: [], alreadySelected: false });
    const selectPrompt = vi.fn().mockResolvedValue({ allSelected: false });
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "sentinel-id" }]),
      }),
    });
    const roomRow = { id: "room-1", status: "prompts", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = {
      select: makeSelectSequence([[roomRow], [roundRow]]),
      insert: insertMock,
    } as any;
    const service = createDebugService(db, {
      promptServiceFactory: () => ({ getPromptOptions, selectPrompt }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-sentinel" });
    await service.performAction("sess-sentinel", "submit_all_prompts");
    expect(insertMock).toHaveBeenCalled();
    expect(selectPrompt).toHaveBeenCalledWith("round-1", "p1", "sentinel-id");
  });

  it("skips players that have already selected", async () => {
    const getPromptOptions = vi.fn().mockResolvedValue({
      options: [{ id: "prompt-1", text: "A dog" }],
      alreadySelected: true, // already selected
    });
    const selectPrompt = vi.fn();
    const roomRow = { id: "room-1", status: "prompts", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as any;
    const service = createDebugService(db, {
      promptServiceFactory: () => ({ getPromptOptions, selectPrompt }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-skip" });
    await service.performAction("sess-skip", "submit_all_prompts");
    expect(selectPrompt).not.toHaveBeenCalled();
  });
});

describe("performAction - submit_all_drawings", () => {
  it("calls submitEntry with empty drawing for each player in current drawing pass", async () => {
    const submitEntry = vi.fn().mockResolvedValue({ allSubmitted: false, roundComplete: false });
    // DB returns: room, round, then one entry row per player (4 players)
    const roomRow = { id: "room-1", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const entryRows = [
      { id: "e1", bookId: "b1", passNumber: 1, authorPlayerId: "p1", submittedAt: null },
      { id: "e2", bookId: "b2", passNumber: 1, authorPlayerId: "p2", submittedAt: null },
      { id: "e3", bookId: "b3", passNumber: 1, authorPlayerId: "p3", submittedAt: null },
      { id: "e4", bookId: "b4", passNumber: 1, authorPlayerId: "p4", submittedAt: null },
    ];
    const db = {
      select: makeSelectSequence([[roomRow], [roundRow], entryRows]),
    } as any;
    const service = createDebugService(db, {
      entryServiceFactory: () => ({ submitEntry }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-d" });
    await service.performAction("sess-d", "submit_all_drawings");
    expect(submitEntry).toHaveBeenCalledTimes(4);
    expect(submitEntry).toHaveBeenCalledWith("b1", 1, "p1", "[]");
  });
});

describe("performAction - submit_all_guesses", () => {
  it("calls submitEntry with debug guess text for each player in current guess pass", async () => {
    const submitEntry = vi.fn().mockResolvedValue({ allSubmitted: false, roundComplete: false });
    const roomRow = { id: "room-1", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 2 }; // pass 2 = guess
    const entryRows = [
      { id: "e1", bookId: "b1", passNumber: 2, authorPlayerId: "p1", submittedAt: null },
      { id: "e2", bookId: "b2", passNumber: 2, authorPlayerId: "p2", submittedAt: null },
      { id: "e3", bookId: "b3", passNumber: 2, authorPlayerId: "p3", submittedAt: null },
      { id: "e4", bookId: "b4", passNumber: 2, authorPlayerId: "p4", submittedAt: null },
    ];
    const db = {
      select: makeSelectSequence([[roomRow], [roundRow], entryRows]),
    } as any;
    const service = createDebugService(db, {
      entryServiceFactory: () => ({ submitEntry }),
    });
    seedSession(service, { ...BASE_SESSION, id: "sess-g" });
    await service.performAction("sess-g", "submit_all_guesses");
    expect(submitEntry).toHaveBeenCalledTimes(4);
    expect(submitEntry).toHaveBeenCalledWith("b1", 2, "p1", "debug guess");
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

- [ ] **Step 5.3: Implement the three remaining actions**

Add `promptServiceFactory` and `entryServiceFactory` to the overrides parameter. Then add to the `performAction` switch:

```typescript
import { createEntryService } from "@/lib/game/entry-service";
import { createPromptService } from "@/lib/game/prompt-service";
import { prompts, entries, books, rounds } from "@/lib/db/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";

// In factory function, add after revealSvc:
const promptSvc = (overrides?.promptServiceFactory ?? createPromptService)(db);
const entrySvc = (overrides?.entryServiceFactory ?? createEntryService)(db);

// In performAction switch, add cases:
case "submit_all_prompts": {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, session.roomId));
  const [round] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, Math.max(room.currentRound, 1))));

  for (const player of session.players) {
    const { options, alreadySelected } = await promptSvc.getPromptOptions(round.id, player.playerId);
    if (alreadySelected) continue;

    let promptId: string;
    if (options.length > 0) {
      promptId = options[0].id;
    } else {
      // Insert sentinel prompt
      const [sentinel] = await db
        .insert(prompts)
        .values({ text: "__debug_prompt__", category: "debug" })
        .returning();
      promptId = sentinel.id;
    }
    await promptSvc.selectPrompt(round.id, player.playerId, promptId);
  }
  break;
}

case "submit_all_drawings": {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, session.roomId));
  const [round] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, room.currentRound)));

  const playerIds = session.players.map((p) => p.playerId);
  const entryRows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.passNumber, round.currentPass),
        inArray(entries.authorPlayerId, playerIds),
        isNull(entries.submittedAt)
      )
    );

  for (const entry of entryRows) {
    await entrySvc.submitEntry(entry.bookId, entry.passNumber, entry.authorPlayerId, "[]");
  }
  break;
}

case "submit_all_guesses": {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, session.roomId));
  const [round] = await db
    .select()
    .from(rounds)
    .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, room.currentRound)));

  const playerIds = session.players.map((p) => p.playerId);
  const entryRows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.passNumber, round.currentPass),
        inArray(entries.authorPlayerId, playerIds),
        isNull(entries.submittedAt)
      )
    );

  for (const entry of entryRows) {
    await entrySvc.submitEntry(entry.bookId, entry.passNumber, entry.authorPlayerId, "debug guess");
  }
  break;
}
```

Note: `makeSelectSequence` uses flat index-based call ordering. When testing actions that need multiple DB queries, make sure the responses array matches the call order exactly.

- [ ] **Step 5.4: Run all debug-service tests**

```bash
npx vitest run src/lib/debug/__tests__/debug-service.test.ts --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/debug/debug-service.ts src/lib/debug/__tests__/debug-service.test.ts
git commit -m "feat(debug): implement submit_all_prompts, submit_all_drawings, submit_all_guesses"
```

---

## Task 6: API route — POST /api/debug/session

**Files:**
- Create: `src/app/api/debug/session/route.ts`
- Create: `src/app/api/debug/session/__tests__/route.test.ts`

- [ ] **Step 6.1: Write failing route tests**

```typescript
// src/app/api/debug/session/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ createSession: mocks.createSession }),
  DebugInvalidConfigError: class DebugInvalidConfigError extends Error {
    constructor(msg: string) { super(msg); this.name = "DebugInvalidConfigError"; }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "../route";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/debug/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/debug/session", () => {
  const OLD_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    vi.clearAllMocks();
    (process.env as any).NODE_ENV = "development";
  });
  afterEach(() => { (process.env as any).NODE_ENV = OLD_ENV; });

  it("returns 404 in production", async () => {
    (process.env as any).NODE_ENV = "production";
    const res = await POST(makeReq({ playerCount: 4 }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid playerCount", async () => {
    const { DebugInvalidConfigError } = await import("@/lib/debug/debug-service");
    mocks.createSession.mockRejectedValue(new DebugInvalidConfigError("bad count"));
    const res = await POST(makeReq({ playerCount: 2 }));
    expect(res.status).toBe(400);
  });

  it("returns 201 with session on success", async () => {
    mocks.createSession.mockResolvedValue({
      id: "sess-1",
      roomCode: "ABCDE",
      players: [{ playerId: "p1", nickname: "Player 1", seatOrder: 0, isHost: true }],
    });
    const res = await POST(makeReq({ playerCount: 4 }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sessionId).toBe("sess-1");
    expect(data.roomCode).toBe("ABCDE");
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
npx vitest run src/app/api/debug/session/__tests__/route.test.ts --reporter=verbose
```

- [ ] **Step 6.3: Implement the route**

```typescript
// src/app/api/debug/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDebugService, DebugInvalidConfigError } from "@/lib/debug/debug-service";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const playerCount = typeof body.playerCount === "number" ? body.playerCount : undefined;

  if (playerCount === undefined) {
    return NextResponse.json({ error: "playerCount is required" }, { status: 400 });
  }

  const service = createDebugService(db);

  try {
    const session = await service.createSession(playerCount);
    return NextResponse.json(
      { sessionId: session.id, roomCode: session.roomCode, players: session.players },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DebugInvalidConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

```bash
npx vitest run src/app/api/debug/session/__tests__/route.test.ts --reporter=verbose
```

- [ ] **Step 6.5: Commit**

```bash
git add src/app/api/debug/session/route.ts src/app/api/debug/session/__tests__/route.test.ts
git commit -m "feat(debug): POST /api/debug/session route"
```

---

## Task 7: API route — GET /api/debug/session/[id]

**Files:**
- Create: `src/app/api/debug/session/[id]/route.ts`
- Create: `src/app/api/debug/session/[id]/__tests__/route.test.ts`

- [ ] **Step 7.1: Write failing tests**

```typescript
// src/app/api/debug/session/[id]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ getSessionState: mocks.getSessionState }),
  DebugSessionNotFoundError: class DebugSessionNotFoundError extends Error {
    constructor(msg: string) { super(msg); this.name = "DebugSessionNotFoundError"; }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "../route";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(id: string) {
  return new NextRequest(`http://localhost/api/debug/session/${id}`);
}

describe("GET /api/debug/session/[id]", () => {
  const OLD_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    vi.clearAllMocks();
    (process.env as any).NODE_ENV = "development";
  });
  afterEach(() => { (process.env as any).NODE_ENV = OLD_ENV; });

  it("returns 404 in production", async () => {
    (process.env as any).NODE_ENV = "production";
    const res = await GET(makeReq("sess-1"), makeParams("sess-1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when session not found", async () => {
    const { DebugSessionNotFoundError } = await import("@/lib/debug/debug-service");
    mocks.getSessionState.mockRejectedValue(new DebugSessionNotFoundError("x"));
    const res = await GET(makeReq("x"), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with session state", async () => {
    mocks.getSessionState.mockResolvedValue({
      sessionId: "sess-1",
      roomCode: "ABCDE",
      roomStatus: "lobby",
      currentRound: 0,
      numRounds: 3,
      players: [],
    });
    const res = await GET(makeReq("sess-1"), makeParams("sess-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.roomCode).toBe("ABCDE");
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
npx vitest run "src/app/api/debug/session/[id]/__tests__/route.test.ts" --reporter=verbose
```

- [ ] **Step 7.3: Implement the route**

```typescript
// src/app/api/debug/session/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDebugService, DebugSessionNotFoundError } from "@/lib/debug/debug-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const service = createDebugService(db);

  try {
    const state = await service.getSessionState(id);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof DebugSessionNotFoundError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    throw err;
  }
}
```

- [ ] **Step 7.4: Run tests to verify they pass**

```bash
npx vitest run "src/app/api/debug/session/[id]/__tests__/route.test.ts" --reporter=verbose
```

- [ ] **Step 7.5: Commit**

```bash
git add "src/app/api/debug/session/[id]/route.ts" "src/app/api/debug/session/[id]/__tests__/route.test.ts"
git commit -m "feat(debug): GET /api/debug/session/[id] route"
```

---

## Task 8: API route — POST /api/debug/session/[id]/action

**Files:**
- Create: `src/app/api/debug/session/[id]/action/route.ts`
- Create: `src/app/api/debug/session/[id]/action/__tests__/route.test.ts`

- [ ] **Step 8.1: Write failing tests**

```typescript
// src/app/api/debug/session/[id]/action/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  performAction: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ performAction: mocks.performAction }),
  DebugSessionNotFoundError: class DebugSessionNotFoundError extends Error {
    constructor(msg: string) { super(msg); this.name = "DebugSessionNotFoundError"; }
  },
  DebugInvalidActionError: class DebugInvalidActionError extends Error {
    constructor(msg: string) { super(msg); this.name = "DebugInvalidActionError"; }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "../route";

function makeReq(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/debug/session/${id}/action`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/debug/session/[id]/action", () => {
  const OLD_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    vi.clearAllMocks();
    (process.env as any).NODE_ENV = "development";
  });
  afterEach(() => { (process.env as any).NODE_ENV = OLD_ENV; });

  it("returns 404 in production", async () => {
    (process.env as any).NODE_ENV = "production";
    const res = await POST(makeReq("s", { action: "start_game" }), makeParams("s"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when action is missing", async () => {
    const res = await POST(makeReq("s", {}), makeParams("s"));
    expect(res.status).toBe(400);
  });

  it("returns 200 on successful action", async () => {
    mocks.performAction.mockResolvedValue(undefined);
    const res = await POST(makeReq("sess-1", { action: "start_game" }), makeParams("sess-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mocks.performAction).toHaveBeenCalledWith("sess-1", "start_game");
  });

  it("returns 404 when session not found", async () => {
    const { DebugSessionNotFoundError } = await import("@/lib/debug/debug-service");
    mocks.performAction.mockRejectedValue(new DebugSessionNotFoundError("x"));
    const res = await POST(makeReq("x", { action: "start_game" }), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when action is invalid for current phase", async () => {
    const { DebugInvalidActionError } = await import("@/lib/debug/debug-service");
    mocks.performAction.mockRejectedValue(new DebugInvalidActionError("wrong phase"));
    const res = await POST(makeReq("s", { action: "advance_reveal" }), makeParams("s"));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

```bash
npx vitest run "src/app/api/debug/session/[id]/action/__tests__/route.test.ts" --reporter=verbose
```

- [ ] **Step 8.3: Implement the route**

```typescript
// src/app/api/debug/session/[id]/action/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createDebugService,
  DebugSessionNotFoundError,
  DebugInvalidActionError,
  type DebugAction,
} from "@/lib/debug/debug-service";

const VALID_ACTIONS: DebugAction[] = [
  "start_game",
  "submit_all_prompts",
  "submit_all_drawings",
  "submit_all_guesses",
  "advance_reveal",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (!action || !VALID_ACTIONS.includes(action as DebugAction)) {
    return NextResponse.json({ error: "Valid action is required" }, { status: 400 });
  }

  const service = createDebugService(db);

  try {
    await service.performAction(id, action as DebugAction);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DebugSessionNotFoundError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (err instanceof DebugInvalidActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

```bash
npx vitest run "src/app/api/debug/session/[id]/action/__tests__/route.test.ts" --reporter=verbose
```

- [ ] **Step 8.5: Commit**

```bash
git add "src/app/api/debug/session/[id]/action/route.ts" "src/app/api/debug/session/[id]/action/__tests__/route.test.ts"
git commit -m "feat(debug): POST /api/debug/session/[id]/action route"
```

---

## Task 9: Debug dashboard UI

No TDD for the UI shell (it's glue code around the API). Build and manually verify.

**Files:**
- Create: `src/app/debug/page.tsx`
- Create: `src/app/debug/DebugDashboard.tsx`

- [ ] **Step 9.1: Create the server page**

```typescript
// src/app/debug/page.tsx
import { notFound } from "next/navigation";
import { DebugDashboard } from "./DebugDashboard";

export default function DebugPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DebugDashboard />;
}
```

- [ ] **Step 9.2: Create the client dashboard component**

```typescript
// src/app/debug/DebugDashboard.tsx
"use client";

import { useState, useEffect, useCallback } from "react";

interface DebugPlayer {
  playerId: string;
  nickname: string;
  isHost: boolean;
  screen: string;
}

interface SessionState {
  sessionId: string;
  roomCode: string;
  roomStatus: string;
  currentRound: number;
  numRounds: number;
  players: DebugPlayer[];
}

type DebugAction =
  | "start_game"
  | "submit_all_prompts"
  | "submit_all_drawings"
  | "submit_all_guesses"
  | "advance_reveal";

const ACTION_LABELS: Record<DebugAction, string> = {
  start_game: "Start Game",
  submit_all_prompts: "Submit All Prompts",
  submit_all_drawings: "Submit All Drawings",
  submit_all_guesses: "Submit All Guesses",
  advance_reveal: "Advance Reveal",
};

const ACTION_PHASES: Record<DebugAction, string[]> = {
  start_game: ["lobby"],
  submit_all_prompts: ["prompts"],
  submit_all_drawings: ["active"],
  submit_all_guesses: ["active"],
  advance_reveal: ["reveal"],
};

export function DebugDashboard() {
  const [playerCount, setPlayerCount] = useState(4);
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<DebugAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/debug/session/${sessionId}`);
    if (res.ok) setSession(await res.json());
  }, []);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => fetchState(session.sessionId), 2000);
    return () => clearInterval(interval);
  }, [session, fetchState]);

  async function createSession() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/debug/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerCount }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setLoading(false); return; }
    // Fetch initial state
    const stateRes = await fetch(`/api/debug/session/${data.sessionId}`);
    if (stateRes.ok) setSession(await stateRes.json());
    setLoading(false);
  }

  async function performAction(action: DebugAction) {
    if (!session) return;
    setActionLoading(action);
    setError(null);
    const res = await fetch(`/api/debug/session/${session.sessionId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Action failed");
    else await fetchState(session.sessionId);
    setActionLoading(null);
  }

  function isActionEnabled(action: DebugAction): boolean {
    if (!session) return false;
    return ACTION_PHASES[action].includes(session.roomStatus);
  }

  return (
    <main className="min-h-screen p-8 font-mono">
      <h1 className="text-2xl font-black mb-6">🛠 Debug Dashboard</h1>

      {!session ? (
        <div className="flex items-center gap-4 mb-8">
          <label className="text-sm">
            Players:
            <select
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value))}
              className="ml-2 border rounded px-2 py-1"
            >
              {[4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            onClick={createSession}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-40"
          >
            {loading ? "Creating..." : "New Session"}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-6 p-4 bg-gray-100 rounded-lg">
            <p className="text-sm text-gray-500">Room</p>
            <p className="text-3xl font-black tracking-widest">{session.roomCode}</p>
            <p className="text-sm mt-1">
              Phase: <strong>{session.roomStatus}</strong> | Round: {session.currentRound}/{session.numRounds}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {session.players.map((p) => (
              <div key={p.playerId} className="border rounded-lg p-3 bg-white">
                <p className="font-bold text-sm">{p.nickname} {p.isHost && "(Host)"}</p>
                <p className="text-xs text-gray-500 mt-1">{p.screen}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {(Object.keys(ACTION_LABELS) as DebugAction[]).map((action) => (
              <button
                key={action}
                onClick={() => performAction(action)}
                disabled={!isActionEnabled(action) || actionLoading !== null}
                className="px-3 py-2 text-sm rounded border bg-white disabled:opacity-30 enabled:hover:bg-gray-50"
              >
                {actionLoading === action ? "..." : ACTION_LABELS[action]}
              </button>
            ))}
          </div>

          <button
            onClick={() => setSession(null)}
            className="text-xs text-gray-400 underline"
          >
            New Session
          </button>
        </>
      )}

      {error && <p className="mt-4 text-red-600 text-sm">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 9.3: Run lint + typecheck**

```bash
cd /Users/mdeforest/Documents/Personal/Projects/telestrations
npx next build --no-lint 2>&1 | tail -20
# Or just typecheck:
npx tsc --noEmit
npx eslint src/lib/debug src/app/debug src/app/api/debug --ext .ts,.tsx
```

Fix any errors before continuing.

- [ ] **Step 9.4: Run the full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all pre-existing tests still pass, plus new debug tests.

- [ ] **Step 9.5: Commit**

```bash
git add src/app/debug/page.tsx src/app/debug/DebugDashboard.tsx
git commit -m "feat(debug): add debug dashboard UI at /debug"
```

---

## Task 10: Final checks and PR

- [ ] **Step 10.1: Run full lint + typecheck**

```bash
npx tsc --noEmit && npx eslint src --ext .ts,.tsx
```

Fix any issues.

- [ ] **Step 10.2: Run full test suite and confirm all pass**

```bash
npx vitest run
```

Expected: all tests pass, output clean (no warnings).

- [ ] **Step 10.3: Commit any lint/typecheck fixes**

```bash
git add -p
git commit -m "fix(debug): resolve lint and typecheck errors"
```

(Only create this commit if there were fixes to make.)

- [ ] **Step 10.4: Push branch and open PR**

```bash
git push -u origin feat/debug-tool-issue-27
gh pr create \
  --title "feat(debug): developer debug dashboard for multi-user simulation (issue #27)" \
  --body "$(cat <<'EOF'
## Summary
- Adds `/debug` page (dev-only) with a state dashboard for simulating multiple players
- `DebugService` manages in-memory sessions and calls existing service factories directly
- Three REST endpoints: create session, get state, perform action
- Actions: start_game, submit_all_prompts, submit_all_drawings, submit_all_guesses, advance_reveal
- All routes return 404 in production

## Test plan
- [ ] All unit tests pass (`npx vitest run`)
- [ ] Typecheck passes (`npx tsc --noEmit`)
- [ ] Open `/debug` locally, create a 4-player session, click through all actions to `finished`
- [ ] Confirm `/debug` returns 404 when `NODE_ENV=production`

Closes #27

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

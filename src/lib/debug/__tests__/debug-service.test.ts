import { describe, it, expect, vi } from "vitest";
import {
  createDebugService,
  DebugSessionNotFoundError,
  DebugInvalidConfigError,
  type DebugSession,
} from "../debug-service";

// ── Mock helpers ─────────────────────────────────────────────────────────────

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

// ── Helper: seed session directly into globalThis store ──────────────────────

function seedSession(session: DebugSession) {
  const store = (globalThis as Record<string, unknown>).__debugSessions__ as Map<string, DebugSession> | undefined;
  if (store) {
    store.set(session.id, session);
  } else {
    const m = new Map<string, DebugSession>();
    m.set(session.id, session);
    (globalThis as Record<string, unknown>).__debugSessions__ = m;
  }
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createDebugService", () => {
  it("getSessionState throws DebugSessionNotFoundError for unknown id", async () => {
    const db = {} as unknown;
    const service = createDebugService(db);
    await expect(service.getSessionState("nonexistent")).rejects.toThrow(DebugSessionNotFoundError);
  });
});

// ── createSession ─────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("throws DebugInvalidConfigError when playerCount < 4", async () => {
    const db = {} as unknown;
    const service = createDebugService(db);
    await expect(service.createSession(3)).rejects.toThrow(DebugInvalidConfigError);
  });

  it("throws DebugInvalidConfigError when playerCount > 6", async () => {
    const db = {} as unknown;
    const service = createDebugService(db);
    await expect(service.createSession(7)).rejects.toThrow(DebugInvalidConfigError);
  });

  it("creates session with 4 players and stores it in the session map", async () => {
    const roomId = "room-id-1";
    let insertCallCount = 0;
    const db = {
      insert: vi.fn().mockImplementation(() => {
        insertCallCount++;
        if (insertCallCount === 1) {
          // First call: insert room
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: roomId, code: "ABCDE" }]),
            }),
          };
        }
        // Subsequent calls: insert each player
        const seatOrder = insertCallCount - 2;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `p-${seatOrder}`, seatOrder }]),
          }),
        };
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown;

    const service = createDebugService(db);
    const session = await service.createSession(4);

    expect(session.roomCode).toBe("ABCDE");
    expect(session.players).toHaveLength(4);
    expect(session.players[0].isHost).toBe(true);
    expect(session.players[1].isHost).toBe(false);
    expect(service.getSession(session.id)).toBe(session);
  });
});

// ── getSessionState ───────────────────────────────────────────────────────────

describe("getSessionState", () => {
  it("returns Lobby screen when room status is lobby", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "lobby", currentRound: 0, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession(BASE_SESSION);
    const state = await service.getSessionState("sess-1");
    expect(state.roomStatus).toBe("lobby");
    expect(state.players[0].screen).toBe("Lobby");
  });

  it("returns PromptSelection screen when room status is prompts", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "prompts", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession({ ...BASE_SESSION, id: "sess-prompts" });
    const state = await service.getSessionState("sess-prompts");
    expect(state.players[0].screen).toBe("PromptSelection");
  });

  it("returns DrawingPhase when status is active and currentPass is 1 (odd)", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession({ ...BASE_SESSION, id: "sess-draw" });
    const state = await service.getSessionState("sess-draw");
    expect(state.players[0].screen).toBe("DrawingPhase");
  });

  it("returns GuessingPhase when status is active and currentPass is 2 (even)", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 2 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession({ ...BASE_SESSION, id: "sess-guess" });
    const state = await service.getSessionState("sess-guess");
    expect(state.players[0].screen).toBe("GuessingPhase");
  });

  it("returns Reveal screen when status is reveal", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "reveal", currentRound: 3, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession({ ...BASE_SESSION, id: "sess-reveal" });
    const state = await service.getSessionState("sess-reveal");
    expect(state.players[0].screen).toBe("Reveal");
  });

  it("returns Finished screen when status is finished", async () => {
    const roomRow = { id: "room-1", code: "ABCDE", status: "finished", currentRound: 3, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession({ ...BASE_SESSION, id: "sess-fin" });
    const state = await service.getSessionState("sess-fin");
    expect(state.players[0].screen).toBe("Finished");
  });
});

// ── performAction ─────────────────────────────────────────────────────────────

describe("performAction", () => {
  it("throws DebugSessionNotFoundError for unknown session", async () => {
    const service = createDebugService({} as unknown);
    await expect(service.performAction("no-such-session", "start_game")).rejects.toThrow(
      DebugSessionNotFoundError
    );
  });

  it("start_game calls startGame with numRounds:3 scoringMode:friendly as host", async () => {
    const startGame = vi.fn().mockResolvedValue({});
    const roomRow = { id: "room-1", status: "lobby", currentRound: 0, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as unknown;
    const service = createDebugService(db, {
      roomServiceFactory: () => ({ startGame }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-sg" });
    await service.performAction("sess-sg", "start_game");
    expect(startGame).toHaveBeenCalledWith("ABCDE", "p1", { numRounds: 3, scoringMode: "friendly" });
  });

  it("start_game throws DebugInvalidActionError when room is not in lobby", async () => {
    const roomRow = { id: "room-1", status: "active", currentRound: 1, numRounds: 3 };
    const db = { select: makeSelectSequence([[roomRow]]) } as unknown;
    const service = createDebugService(db);
    seedSession({ ...BASE_SESSION, id: "sess-sg-bad" });
    await expect(service.performAction("sess-sg-bad", "start_game")).rejects.toThrow(
      "start_game requires lobby status"
    );
  });

  it("advance_reveal calls advanceReveal with host playerId", async () => {
    const advanceReveal = vi.fn().mockResolvedValue({});
    const service = createDebugService({} as unknown, {
      revealServiceFactory: () => ({ advanceReveal }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-ar" });
    await service.performAction("sess-ar", "advance_reveal");
    expect(advanceReveal).toHaveBeenCalledWith("ABCDE", "p1");
  });
});

// ── performAction - submit_all_prompts ────────────────────────────────────────

describe("performAction - submit_all_prompts", () => {
  it("calls selectPrompt for each player using the first available prompt option", async () => {
    const getPromptOptions = vi.fn().mockResolvedValue({
      options: [{ id: "prompt-1", text: "A cat" }],
      alreadySelected: false,
    });
    const selectPrompt = vi.fn().mockResolvedValue({ allSelected: false });
    const roomRow = { id: "room-1", status: "prompts", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as unknown;
    const service = createDebugService(db, {
      promptServiceFactory: () => ({ getPromptOptions, selectPrompt }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-p1" });
    await service.performAction("sess-p1", "submit_all_prompts");
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
    } as unknown;
    const service = createDebugService(db, {
      promptServiceFactory: () => ({ getPromptOptions, selectPrompt }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-sentinel" });
    await service.performAction("sess-sentinel", "submit_all_prompts");
    expect(insertMock).toHaveBeenCalled();
    expect(selectPrompt).toHaveBeenCalledWith("round-1", "p1", "sentinel-id");
  });

  it("skips players that have already selected", async () => {
    const getPromptOptions = vi.fn().mockResolvedValue({
      options: [{ id: "prompt-1", text: "A dog" }],
      alreadySelected: true,
    });
    const selectPrompt = vi.fn();
    const roomRow = { id: "room-1", status: "prompts", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const db = { select: makeSelectSequence([[roomRow], [roundRow]]) } as unknown;
    const service = createDebugService(db, {
      promptServiceFactory: () => ({ getPromptOptions, selectPrompt }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-skip" });
    await service.performAction("sess-skip", "submit_all_prompts");
    expect(selectPrompt).not.toHaveBeenCalled();
  });
});

// ── performAction - submit_all_drawings ───────────────────────────────────────

describe("performAction - submit_all_drawings", () => {
  it("calls submitEntry with empty drawing for each player in current drawing pass", async () => {
    const submitEntry = vi.fn().mockResolvedValue({ allSubmitted: false, roundComplete: false });
    const roomRow = { id: "room-1", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 1 };
    const entryRows = [
      { id: "e1", bookId: "b1", passNumber: 1, authorPlayerId: "p1", submittedAt: null },
      { id: "e2", bookId: "b2", passNumber: 1, authorPlayerId: "p2", submittedAt: null },
      { id: "e3", bookId: "b3", passNumber: 1, authorPlayerId: "p3", submittedAt: null },
      { id: "e4", bookId: "b4", passNumber: 1, authorPlayerId: "p4", submittedAt: null },
    ];
    const db = { select: makeSelectSequence([[roomRow], [roundRow], entryRows]) } as unknown;
    const service = createDebugService(db, {
      entryServiceFactory: () => ({ submitEntry }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-d1" });
    await service.performAction("sess-d1", "submit_all_drawings");
    expect(submitEntry).toHaveBeenCalledTimes(4);
    expect(submitEntry).toHaveBeenCalledWith("b1", 1, "p1", "[]");
  });
});

// ── performAction - submit_all_guesses ────────────────────────────────────────

describe("performAction - submit_all_guesses", () => {
  it("calls submitEntry with debug guess text for each player in current guess pass", async () => {
    const submitEntry = vi.fn().mockResolvedValue({ allSubmitted: false, roundComplete: false });
    const roomRow = { id: "room-1", status: "active", currentRound: 1, numRounds: 3 };
    const roundRow = { id: "round-1", currentPass: 2 };
    const entryRows = [
      { id: "e1", bookId: "b1", passNumber: 2, authorPlayerId: "p1", submittedAt: null },
      { id: "e2", bookId: "b2", passNumber: 2, authorPlayerId: "p2", submittedAt: null },
      { id: "e3", bookId: "b3", passNumber: 2, authorPlayerId: "p3", submittedAt: null },
      { id: "e4", bookId: "b4", passNumber: 2, authorPlayerId: "p4", submittedAt: null },
    ];
    const db = { select: makeSelectSequence([[roomRow], [roundRow], entryRows]) } as unknown;
    const service = createDebugService(db, {
      entryServiceFactory: () => ({ submitEntry }),
    });
    seedSession({ ...BASE_SESSION, id: "sess-g1" });
    await service.performAction("sess-g1", "submit_all_guesses");
    expect(submitEntry).toHaveBeenCalledTimes(4);
    expect(submitEntry).toHaveBeenCalledWith("b1", 2, "p1", "debug guess");
  });
});

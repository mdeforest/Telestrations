import { describe, it, expect, vi } from "vitest";
import {
  createRoomService,
  RoomNotFoundError,
  DuplicateNicknameError,
  NotHostError,
  InsufficientPlayersError,
  InvalidConfigError,
} from "../service";

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_CODE_CHARS = /^[A-Z]{6}$/;
const AMBIGUOUS = /[0O1Il]/;

// ── Mocks ──────────────────────────────────────────────────────────────────

/**
 * Insert mock that echoes back inserted values with generated IDs.
 * Tracks all calls in insertCalls for assertions.
 */
function makeTrackingInsertMock() {
  const insertCalls: Array<{ values: unknown[] }> = [];
  let callIdx = 0;
  const insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      const idx = callIdx++;
      const arr = Array.isArray(vals) ? vals : [vals];
      insertCalls.push({ values: arr });
      const rows = arr.map((v, i) => ({
        id: `row-${idx}-${i}`,
        ...(v as object),
      }));
      return { returning: vi.fn().mockResolvedValue(rows) };
    }),
  }));
  return { insert, insertCalls };
}

function makeDb() {
  // Default insert mock: echoes values back with generated IDs, supports chaining.
  const { insert } = makeTrackingInsertMock();
  return {
    insert,
    select: vi.fn(),
    update: vi.fn(),
  };
}

// ── Shared mock builders ───────────────────────────────────────────────────

function makeInsertMock(rows: unknown[][]) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows[callCount++] ?? []),
    }),
  }));
}

function makeSelectMock(rows: unknown[]) {
  return vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

function makeUpdateMock() {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createRoom", () => {
  it("returns a 6-char uppercase-alpha code with no ambiguous characters", async () => {
    const db = makeDb();
    db.insert = makeInsertMock([
      [{ id: "room-1", code: "ABCDEF" }],
      [{ id: "player-1", seatOrder: 1 }],
    ]);
    db.update = makeUpdateMock();

    const service = createRoomService(db as never);
    const { code } = await service.createRoom("alice");

    expect(code).toMatch(VALID_CODE_CHARS);
    expect(code).not.toMatch(AMBIGUOUS);
  });

  it("stores the creator's nickname and returns their playerId", async () => {
    const db = makeDb();
    let insertNickname: string | undefined;
    db.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals: { nickname?: string }) => {
        if (vals?.nickname) insertNickname = vals.nickname;
        return {
          returning: vi.fn().mockResolvedValue(
            vals?.nickname
              ? [{ id: "player-1", seatOrder: 1 }]
              : [{ id: "room-1", code: "ABCDEF" }]
          ),
        };
      }),
    }));
    db.update = makeUpdateMock();

    const service = createRoomService(db as never);
    const result = await service.createRoom("alice");

    expect(insertNickname).toBe("alice");
    expect(result.hostPlayerId).toBe("player-1");
  });
});

// ── startGame helpers ──────────────────────────────────────────────────────

function makeSelectForStartGame(playerCount: number) {
  const playerRows = Array.from({ length: playerCount }, (_, i) => ({
    id: `player-${i + 1}`,
    nickname: `player${i + 1}`,
    seatOrder: i + 1,
  }));
  let selectCount = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        selectCount++;
        if (selectCount === 1)
          return Promise.resolve([
            { id: "room-1", code: "ABCDEF", hostPlayerId: "player-1", status: "lobby" },
          ]);
        return Promise.resolve(playerRows);
      }),
    }),
  }));
}

function makeUpdateReturningMock(returnRow: unknown) {
  return vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([returnRow]),
      }),
    }),
  });
}

describe("startGame", () => {
  it("transitions room status to prompts and returns updated room", async () => {
    const db = makeDb();
    db.select = makeSelectForStartGame(4);
    db.update = makeUpdateReturningMock({
      id: "room-1",
      code: "ABCDEF",
      status: "prompts",
      numRounds: 5,
      scoringMode: "competitive",
    });

    const service = createRoomService(db as never);
    const result = await service.startGame("ABCDEF", "player-1", {
      numRounds: 5,
      scoringMode: "competitive",
    });

    expect(result.status).toBe("prompts");
    expect(result.code).toBe("ABCDEF");
  });

  it("throws RoomNotFoundError when room does not exist", async () => {
    const db = makeDb();
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const service = createRoomService(db as never);
    await expect(
      service.startGame("XXXXXX", "player-1", { numRounds: 3, scoringMode: "friendly" })
    ).rejects.toThrow(RoomNotFoundError);
  });

  it("throws NotHostError when caller is not the host", async () => {
    const db = makeDb();
    db.select = makeSelectForStartGame(4); // hostPlayerId is player-1

    const service = createRoomService(db as never);
    await expect(
      service.startGame("ABCDEF", "player-2", { numRounds: 3, scoringMode: "friendly" })
    ).rejects.toThrow(NotHostError);
  });

  it("throws InsufficientPlayersError when fewer than 4 players have joined", async () => {
    const db = makeDb();
    db.select = makeSelectForStartGame(3);

    const service = createRoomService(db as never);
    await expect(
      service.startGame("ABCDEF", "player-1", { numRounds: 3, scoringMode: "friendly" })
    ).rejects.toThrow(InsufficientPlayersError);
  });

  it("throws InvalidConfigError when numRounds is outside 3–8", async () => {
    const db = makeDb();
    // select never reached — validation fires first
    db.select = vi.fn();

    const service = createRoomService(db as never);
    await expect(
      service.startGame("ABCDEF", "player-1", { numRounds: 2, scoringMode: "friendly" })
    ).rejects.toThrow(InvalidConfigError);
    await expect(
      service.startGame("ABCDEF", "player-1", { numRounds: 9, scoringMode: "friendly" })
    ).rejects.toThrow(InvalidConfigError);
  });

  it("persists numRounds and scoringMode to the database", async () => {
    const db = makeDb();
    db.select = makeSelectForStartGame(4);

    let capturedSet: Record<string, unknown> | undefined;
    db.update = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        capturedSet = values;
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: "room-1", code: "ABCDEF", status: "prompts", numRounds: 6, scoringMode: "competitive" },
            ]),
          }),
        };
      }),
    });

    const service = createRoomService(db as never);
    await service.startGame("ABCDEF", "player-1", { numRounds: 6, scoringMode: "competitive" });

    expect(capturedSet?.numRounds).toBe(6);
    expect(capturedSet?.scoringMode).toBe("competitive");
    expect(capturedSet?.status).toBe("prompts");
  });

  it("creates the correct number of rounds, books, and entries for even N (N=4, numRounds=3)", async () => {
    const { insert, insertCalls } = makeTrackingInsertMock();
    const db = makeDb();
    db.insert = insert;
    db.select = makeSelectForStartGame(4);
    db.update = makeUpdateReturningMock({
      id: "room-1", code: "ABCDEF", status: "prompts", numRounds: 3, scoringMode: "friendly",
    });

    const service = createRoomService(db as never);
    await service.startGame("ABCDEF", "player-1", { numRounds: 3, scoringMode: "friendly" });

    // Order: rounds, (books_r1, entries_r1), (books_r2, entries_r2), (books_r3, entries_r3) = 7 total
    expect(insertCalls).toHaveLength(7);

    // First insert: 3 rounds
    expect(insertCalls[0].values).toHaveLength(3);

    // Per-round: books at odd indices [1,3,5], entries at even indices [2,4,6]
    for (const i of [1, 3, 5]) {
      expect(insertCalls[i].values).toHaveLength(4); // 4 books per round
    }
    for (const i of [2, 4, 6]) {
      expect(insertCalls[i].values).toHaveLength(16); // 4 books × 4 passes
    }
  });

  it("creates the correct number of rounds, books, and entries for odd N (N=5, numRounds=3)", async () => {
    const { insert, insertCalls } = makeTrackingInsertMock();
    const db = makeDb();
    db.insert = insert;
    db.select = makeSelectForStartGame(5);
    db.update = makeUpdateReturningMock({
      id: "room-1", code: "ABCDEF", status: "prompts", numRounds: 3, scoringMode: "friendly",
    });

    const service = createRoomService(db as never);
    await service.startGame("ABCDEF", "player-1", { numRounds: 3, scoringMode: "friendly" });

    // Order: rounds, (books_r1, entries_r1), (books_r2, entries_r2), (books_r3, entries_r3) = 7 total
    expect(insertCalls).toHaveLength(7);

    // First insert: 3 rounds
    expect(insertCalls[0].values).toHaveLength(3);

    // Per-round: books at odd indices, entries at even indices
    for (const i of [1, 3, 5]) {
      expect(insertCalls[i].values).toHaveLength(5); // 5 books per round
    }
    for (const i of [2, 4, 6]) {
      expect(insertCalls[i].values).toHaveLength(20); // 5 books × 4 passes (N-1=4)
    }
  });

  it("assigns correct authorPlayerId for each entry using chainRouter (even N=4)", async () => {
    const { insert, insertCalls } = makeTrackingInsertMock();
    const db = makeDb();
    db.insert = insert;
    db.select = makeSelectForStartGame(4);
    db.update = makeUpdateReturningMock({
      id: "room-1", code: "ABCDEF", status: "prompts", numRounds: 3, scoringMode: "friendly",
    });

    const service = createRoomService(db as never);
    await service.startGame("ABCDEF", "player-1", { numRounds: 3, scoringMode: "friendly" });

    // insertCalls[0] = rounds, insertCalls[1] = books for round 1, insertCalls[2] = entries for round 1
    const entries = insertCalls[2].values as Array<{
      passNumber: number;
      authorPlayerId: string;
      type: string;
    }>;

    // Book 0 (owner = player-1, seatOrder=1, ownerSeat=0), N=4:
    // pass 1: (0+1-1)%4 = 0 → seatOrder=1 → player-1
    // pass 2: (0+2-1)%4 = 1 → seatOrder=2 → player-2
    // pass 3: (0+3-1)%4 = 2 → seatOrder=3 → player-3
    // pass 4: (0+4-1)%4 = 3 → seatOrder=4 → player-4
    const book0Entries = entries.slice(0, 4);
    expect(book0Entries[0]).toMatchObject({ passNumber: 1, authorPlayerId: "player-1", type: "drawing" });
    expect(book0Entries[1]).toMatchObject({ passNumber: 2, authorPlayerId: "player-2", type: "guess" });
    expect(book0Entries[2]).toMatchObject({ passNumber: 3, authorPlayerId: "player-3", type: "drawing" });
    expect(book0Entries[3]).toMatchObject({ passNumber: 4, authorPlayerId: "player-4", type: "guess" });
  });

  it("assigns correct authorPlayerId for odd N (N=5) — owner never authors their own chain", async () => {
    const { insert, insertCalls } = makeTrackingInsertMock();
    const db = makeDb();
    db.insert = insert;
    db.select = makeSelectForStartGame(5);
    db.update = makeUpdateReturningMock({
      id: "room-1", code: "ABCDEF", status: "prompts", numRounds: 3, scoringMode: "friendly",
    });

    const service = createRoomService(db as never);
    await service.startGame("ABCDEF", "player-1", { numRounds: 3, scoringMode: "friendly" });

    const entries = insertCalls[2].values as Array<{
      passNumber: number;
      authorPlayerId: string;
      type: string;
    }>;

    // Book 0 (owner = player-1, seatOrder=1, ownerSeat=0), N=5, chainLength=4:
    // pass 1: (0+1)%5 = 1 → seatOrder=2 → player-2
    // pass 2: (0+2)%5 = 2 → seatOrder=3 → player-3
    // pass 3: (0+3)%5 = 3 → seatOrder=4 → player-4
    // pass 4: (0+4)%5 = 4 → seatOrder=5 → player-5
    const book0Entries = entries.slice(0, 4);
    expect(book0Entries[0]).toMatchObject({ passNumber: 1, authorPlayerId: "player-2", type: "drawing" });
    expect(book0Entries[1]).toMatchObject({ passNumber: 2, authorPlayerId: "player-3", type: "guess" });
    expect(book0Entries[2]).toMatchObject({ passNumber: 3, authorPlayerId: "player-4", type: "drawing" });
    expect(book0Entries[3]).toMatchObject({ passNumber: 4, authorPlayerId: "player-5", type: "guess" });

    // Owner (player-1) must not appear as author of their own book
    const authorIds = book0Entries.map((e) => e.authorPlayerId);
    expect(authorIds).not.toContain("player-1");
  });
});

describe("joinRoom", () => {
  it("returns playerId and seatOrder when room exists and nickname is unique", async () => {
    const db = makeDb();
    db.select = makeSelectMock([{ id: "room-1", code: "ABCDEF" }]);
    db.insert = makeInsertMock([[{ id: "player-2", seatOrder: 2 }]]);
    // Override select to return room on first call, players on second
    let selectCount = 0;
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCount++;
          if (selectCount === 1) return Promise.resolve([{ id: "room-1", code: "ABCDEF" }]);
          return Promise.resolve([{ id: "player-1", nickname: "alice", seatOrder: 1 }]);
        }),
      }),
    }));

    const service = createRoomService(db as never);
    const result = await service.joinRoom("ABCDEF", "bob");

    expect(result.playerId).toBe("player-2");
    expect(result.seatOrder).toBe(2);
  });

  it("throws RoomNotFoundError when room code does not exist", async () => {
    const db = makeDb();
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]), // no room found
      }),
    });

    const service = createRoomService(db as never);
    await expect(service.joinRoom("XXXXXX", "bob")).rejects.toThrow(RoomNotFoundError);
  });

  it("throws DuplicateNicknameError when nickname is already taken in the room", async () => {
    const db = makeDb();
    let selectCount = 0;
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCount++;
          if (selectCount === 1) return Promise.resolve([{ id: "room-1", code: "ABCDEF" }]);
          return Promise.resolve([{ id: "player-1", nickname: "alice", seatOrder: 1 }]);
        }),
      }),
    }));

    const service = createRoomService(db as never);
    await expect(service.joinRoom("ABCDEF", "alice")).rejects.toThrow(DuplicateNicknameError);
  });
});

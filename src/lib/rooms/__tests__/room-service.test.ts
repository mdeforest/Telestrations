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

function makeDb() {
  return {
    insert: vi.fn(),
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

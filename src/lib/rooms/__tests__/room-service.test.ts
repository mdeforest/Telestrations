import { describe, it, expect, vi } from "vitest";
import { createRoomService, RoomNotFoundError, DuplicateNicknameError } from "../service";

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

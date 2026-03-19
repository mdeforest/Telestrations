import { describe, it, expect, vi } from "vitest";
import {
  createPlayerConnectionService,
  PlayerNotFoundError,
} from "../player-connection-service";

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => Promise.resolve(responses[callIdx++] ?? [])),
    }),
  }));
}

function makeTrackingUpdateMock() {
  const setCalls: Array<Record<string, unknown>> = [];
  const mock = vi.fn().mockReturnValue({
    set: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      setCalls.push(vals);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...vals }]),
        }),
      };
    }),
  });
  return { mock, setCalls };
}

// ── Test data ────────────────────────────────────────────────────────────────

const PLAYER_ID = "player-1";
const ROOM_ID = "room-1";
const ROOM_CODE = "ABCDEF";

const PLAYER_ROW = {
  id: PLAYER_ID,
  roomId: ROOM_ID,
  nickname: "Alice",
  isConnected: true,
};

const ROOM_ROW = {
  id: ROOM_ID,
  code: ROOM_CODE,
};

// ── updateConnection tests ───────────────────────────────────────────────────

describe("updateConnection", () => {
  it("sets isConnected = false when a player disconnects", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([[PLAYER_ROW], [ROOM_ROW]]),
      update: updateMock,
    };

    const service = createPlayerConnectionService(db as never);
    await service.updateConnection(PLAYER_ID, false);

    expect(setCalls[0]).toMatchObject({ isConnected: false });
  });

  it("sets isConnected = true when a player reconnects", async () => {
    const disconnectedPlayer = { ...PLAYER_ROW, isConnected: false };
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([[disconnectedPlayer], [ROOM_ROW]]),
      update: updateMock,
    };

    const service = createPlayerConnectionService(db as never);
    await service.updateConnection(PLAYER_ID, true);

    expect(setCalls[0]).toMatchObject({ isConnected: true });
  });

  it("throws PlayerNotFoundError when the player does not exist", async () => {
    const db = {
      select: makeSelectSequence([[]]),
      update: vi.fn(),
    };

    const service = createPlayerConnectionService(db as never);
    await expect(
      service.updateConnection("nonexistent", false)
    ).rejects.toThrow(PlayerNotFoundError);
  });

  it("returns the room code so callers can publish Ably events", async () => {
    const { mock: updateMock } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([[PLAYER_ROW], [ROOM_ROW]]),
      update: updateMock,
    };

    const service = createPlayerConnectionService(db as never);
    const result = await service.updateConnection(PLAYER_ID, false);

    expect(result.roomCode).toBe(ROOM_CODE);
    expect(result.nickname).toBe("Alice");
  });
});

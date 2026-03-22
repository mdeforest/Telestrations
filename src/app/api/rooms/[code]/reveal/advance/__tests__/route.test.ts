import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ─────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getPlayerId: vi.fn(),
  advanceReveal: vi.fn(),
  ablyPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/debug/get-player-id", () => ({
  getPlayerId: mocks.getPlayerId,
}));

vi.mock("@/lib/game/reveal-service", () => ({
  createRevealService: () => ({ advanceReveal: mocks.advanceReveal }),
  RoomNotFoundError: class RoomNotFoundError extends Error {
    constructor(msg: string) { super(msg); this.name = "RoomNotFoundError"; }
  },
  NotHostError: class NotHostError extends Error {
    constructor() { super("not host"); this.name = "NotHostError"; }
  },
  NotRevealPhaseError: class NotRevealPhaseError extends Error {
    constructor() { super("not reveal phase"); this.name = "NotRevealPhaseError"; }
  },
}));

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/realtime/server", () => ({
  getAblyRest: () => ({
    channels: { get: () => ({ publish: mocks.ablyPublish }) },
  }),
}));

// Import AFTER mocks
import { POST } from "../route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(code = "ABCDEF") {
  return new NextRequest(`http://localhost/api/rooms/${code}/reveal/advance`, {
    method: "POST",
  });
}

function makeParams(code = "ABCDEF") {
  return { params: Promise.resolve({ code }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/rooms/[code]/reveal/advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ablyPublish.mockResolvedValue(undefined);
  });

  it("returns 401 when playerId cookie is missing", async () => {
    mocks.getPlayerId.mockResolvedValue(undefined);
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the room does not exist", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");
    const { RoomNotFoundError } = await import("@/lib/game/reveal-service");
    mocks.advanceReveal.mockRejectedValue(new RoomNotFoundError("ABCDEF"));

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not the host", async () => {
    mocks.getPlayerId.mockResolvedValue("player-2");
    const { NotHostError } = await import("@/lib/game/reveal-service");
    mocks.advanceReveal.mockRejectedValue(new NotHostError());

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns 200 with updated indices on success", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.advanceReveal.mockResolvedValue({
      revealBookIndex: 0,
      revealEntryIndex: 1,
      finished: false,
    });

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      revealBookIndex: 0,
      revealEntryIndex: 1,
      finished: false,
    });
  });

  it("publishes reveal:advance Ably event with updated indices", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.advanceReveal.mockResolvedValue({
      revealBookIndex: 1,
      revealEntryIndex: 0,
      finished: false,
    });

    await POST(makeReq(), makeParams());

    expect(mocks.ablyPublish).toHaveBeenCalledWith("reveal:advance", {
      revealBookIndex: 1,
      revealEntryIndex: 0,
      finished: false,
    });
  });

  it("returns 409 when room is not in reveal phase", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    const { NotRevealPhaseError } = await import("@/lib/game/reveal-service");
    mocks.advanceReveal.mockRejectedValue(new NotRevealPhaseError());

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(409);
  });

  it("publishes room-status-changed prompts event when nextRound is true", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.advanceReveal.mockResolvedValue({
      revealBookIndex: 1,
      revealEntryIndex: 1,
      finished: false,
      nextRound: true,
      nextRoundId: "round-2",
    });

    await POST(makeReq(), makeParams());

    // Should publish both reveal:advance AND room-status-changed
    expect(mocks.ablyPublish).toHaveBeenCalledWith("reveal:advance", expect.objectContaining({
      nextRound: true,
      nextRoundId: "round-2",
    }));
    expect(mocks.ablyPublish).toHaveBeenCalledWith("room-status-changed", {
      status: "prompts",
      roundId: "round-2",
    });
  });

  it("does not publish room-status-changed when nextRound is false", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.advanceReveal.mockResolvedValue({
      revealBookIndex: 0,
      revealEntryIndex: 1,
      finished: false,
      nextRound: false,
      nextRoundId: null,
    });

    await POST(makeReq(), makeParams());

    expect(mocks.ablyPublish).toHaveBeenCalledTimes(1);
    expect(mocks.ablyPublish).toHaveBeenCalledWith("reveal:advance", expect.anything());
  });
});

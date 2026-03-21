import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getPlayerId: vi.fn(),
  dbSelect: vi.fn(),
  tallyVotes: vi.fn(),
  ablyPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/debug/get-player-id", () => ({
  getPlayerId: mocks.getPlayerId,
}));

vi.mock("@/lib/db", () => ({ db: { select: mocks.dbSelect } }));

vi.mock("@/lib/game/vote-service", () => ({
  createVoteService: () => ({ tallyVotes: mocks.tallyVotes }),
}));

vi.mock("@/lib/realtime/server", () => ({
  getAblyRest: () => ({
    channels: { get: () => ({ publish: mocks.ablyPublish }) },
  }),
}));

// Import AFTER mocks
import { POST } from "../route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(code = "ABCDEF") {
  return new NextRequest(`http://localhost/api/rooms/${code}/tally`, {
    method: "POST",
  });
}

function makeParams(code = "ABCDEF") {
  return { params: Promise.resolve({ code }) };
}

const ROOM_ROW = {
  id: "room-1",
  code: "ABCDEF",
  hostPlayerId: "host-1",
  status: "finished",
  scoringMode: "friendly",
};

const LEADERBOARD_ROWS = [
  { playerId: "p1", nickname: "Alice", totalPoints: 3 },
  { playerId: "p2", nickname: "Bob", totalPoints: 1 },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /api/rooms/[code]/tally", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ablyPublish.mockResolvedValue(undefined);
    mocks.tallyVotes.mockResolvedValue([]);
  });

  it("returns 401 when playerId cookie is missing", async () => {
    mocks.getPlayerId.mockResolvedValue(undefined);
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the room does not exist", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }));

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not the host", async () => {
    mocks.getPlayerId.mockResolvedValue("not-host");
    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROOM_ROW]),
        }),
      }));

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns 409 when the room is not finished", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...ROOM_ROW, status: "reveal" }]),
        }),
      }));

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(409);
  });

  it("calls tallyVotes with the room id on success", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROOM_ROW]),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(LEADERBOARD_ROWS),
              }),
            }),
          }),
        }),
      }));

    await POST(makeReq(), makeParams());
    expect(mocks.tallyVotes).toHaveBeenCalledWith("room-1");
  });

  it("returns 200 with leaderboard data on success", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROOM_ROW]),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(LEADERBOARD_ROWS),
              }),
            }),
          }),
        }),
      }));

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0]).toMatchObject({ nickname: "Alice", totalPoints: 3 });
  });

  it("publishes scoring:complete Ably event with leaderboard", async () => {
    mocks.getPlayerId.mockResolvedValue("host-1");
    mocks.dbSelect
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROOM_ROW]),
        }),
      }))
      .mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(LEADERBOARD_ROWS),
              }),
            }),
          }),
        }),
      }));

    await POST(makeReq(), makeParams());

    expect(mocks.ablyPublish).toHaveBeenCalledWith("scoring:complete", {
      leaderboard: LEADERBOARD_ROWS,
    });
  });
});

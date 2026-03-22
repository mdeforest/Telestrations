import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getPlayerId: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock("@/lib/debug/get-player-id", () => ({
  getPlayerId: mocks.getPlayerId,
}));

vi.mock("@/lib/db", () => ({ db: { select: mocks.dbSelect } }));

// Import AFTER mocks
import { GET } from "../route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(code = "ABCDEF") {
  return new NextRequest(`http://localhost/api/rooms/${code}/leaderboard`);
}

function makeParams(code = "ABCDEF") {
  return { params: Promise.resolve({ code }) };
}

const ROOM_ROW = { id: "room-1", code: "ABCDEF", status: "finished" };

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /api/rooms/[code]/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when playerId cookie is missing", async () => {
    mocks.getPlayerId.mockResolvedValue(undefined);
    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the room does not exist", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");

    // First select: room lookup → empty
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(Promise.resolve([])),
      }),
    }));

    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns players ranked by total points descending", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");

    // First select: room lookup
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(Promise.resolve([ROOM_ROW])),
      }),
    }));

    // Second select: score aggregation → [(Alice, 2), (Bob, 1)]
    const leaderboardRows = [
      { playerId: "p1", nickname: "Alice", totalPoints: 2 },
      { playerId: "p2", nickname: "Bob", totalPoints: 1 },
    ];
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue(Promise.resolve(leaderboardRows)),
            }),
          }),
        }),
      }),
    }));

    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0]).toMatchObject({ nickname: "Alice", totalPoints: 2 });
    expect(body.leaderboard[1]).toMatchObject({ nickname: "Bob", totalPoints: 1 });
  });

  it("returns an empty leaderboard when there are no scores", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");

    // Room lookup
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(Promise.resolve([ROOM_ROW])),
      }),
    }));

    // No scores
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue(Promise.resolve([])),
            }),
          }),
        }),
      }),
    }));

    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.leaderboard).toHaveLength(0);
  });
});

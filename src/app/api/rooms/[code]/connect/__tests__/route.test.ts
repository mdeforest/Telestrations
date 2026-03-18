import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Shared mock state (hoisted so vi.mock factories can reference it) ─────────

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  selectWhere: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: mocks.cookieSet }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mocks.selectWhere,
      }),
    }),
  },
}));

// Import AFTER mocks are declared
import { GET } from "../route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(code: string, pid?: string) {
  const qs = pid ? `?pid=${pid}` : "";
  return new NextRequest(`http://localhost/room/${code}/connect${qs}`);
}

function makeParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /room/[code]/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when pid query param is missing", async () => {
    const res = await GET(makeReq("ABCDEF"), makeParams("ABCDEF"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when room is not found", async () => {
    mocks.selectWhere.mockResolvedValueOnce([]); // room lookup → empty
    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when player does not belong to the room", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF" }]) // room found
      .mockResolvedValueOnce([]); // player not in this room
    const res = await GET(makeReq("ABCDEF", "other-player"), makeParams("ABCDEF"));
    expect(res.status).toBe(404);
  });

  it("sets playerId cookie and redirects to /room/[code] when valid", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF" }])
      .mockResolvedValueOnce([{ id: "player-1", roomId: "room-1" }]);
    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/room\/ABCDEF/);
    expect(mocks.cookieSet).toHaveBeenCalledWith("playerId", "player-1", {
      httpOnly: true,
      path: "/",
    });
  });
});

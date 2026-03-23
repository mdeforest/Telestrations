import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Shared mock state (hoisted so vi.mock factories can reference it) ─────────

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  selectWhere: vi.fn(),
  updateReturning: vi.fn(),
  ablyPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: mocks.cookieSet }),
  headers: () => Promise.resolve(new Headers({ host: "localhost:3000" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mocks.selectWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mocks.updateReturning }) }) }),
  },
}));

vi.mock("@/lib/realtime/server", () => ({
  getAblyRest: () => ({
    channels: { get: () => ({ publish: mocks.ablyPublish }) },
  }),
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

  it("returns 404 when player does not exist", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }]) // room found
      .mockResolvedValueOnce([]); // player lookup returns empty
    const res = await GET(makeReq("ABCDEF", "other-player"), makeParams("ABCDEF"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when player exists but belongs to a different room", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }])
      .mockResolvedValueOnce([{ id: "player-1", roomId: "room-DIFFERENT" }]);
    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(404);
  });

  it("sets playerId cookie, publishes Ably event, and redirects to /room/[CODE] when valid", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }])
      .mockResolvedValueOnce([{ id: "player-1", roomId: "room-1" }]);
    // player-1 is NOT the host, so no updateReturning needed
    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/room\/ABCDEF/);
    expect(mocks.cookieSet).toHaveBeenCalledWith("playerId", "player-1", {
      httpOnly: true,
      path: "/",
    });
    expect(mocks.ablyPublish).toHaveBeenCalledWith("host-phone-connected", null);
  });

  it("normalises lowercase room code to uppercase in the redirect", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }])
      .mockResolvedValueOnce([{ id: "player-1", roomId: "room-1" }]);
    const res = await GET(makeReq("abcdef", "player-1"), makeParams("abcdef"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/room\/ABCDEF/);
  });

  it("returns 409 when the host QR has already been used", async () => {
    mocks.selectWhere.mockResolvedValueOnce([{
      id: "room-1",
      code: "ABCDEF",
      hostPlayerId: "player-1",
      hostPhoneConnectedAt: new Date(),
    }]);
    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already been used/i);
  });

  it("returns 409 when conditional update claims 0 rows (race condition)", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "player-1", hostPhoneConnectedAt: null }]);
    mocks.updateReturning.mockResolvedValueOnce([]); // 0 rows — race lost

    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already been used/i);
  });

  it("returns 409 when the host QR is scanned a second time by any user", async () => {
    mocks.selectWhere.mockResolvedValueOnce([{
      id: "room-1",
      code: "ABCDEF",
      hostPlayerId: "player-1",         // the pid in the QR URL
      hostPhoneConnectedAt: new Date(), // already claimed
    }]);
    const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
    expect(res.status).toBe(409);
  });

  it("allows a non-host player to connect without the one-time guard", async () => {
    mocks.selectWhere
      .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }])
      .mockResolvedValueOnce([{ id: "player-2", roomId: "room-1" }]);
    // No updateReturning mock — update should NOT be called for non-host

    const res = await GET(makeReq("ABCDEF", "player-2"), makeParams("ABCDEF"));
    expect(res.status).toBe(307);
    expect(mocks.updateReturning).not.toHaveBeenCalled();
  });
});

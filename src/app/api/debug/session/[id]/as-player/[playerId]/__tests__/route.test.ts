import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ getSession: mocks.getSession }),
  DebugSessionNotFoundError: class DebugSessionNotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "DebugSessionNotFoundError";
    }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "../route";

const FAKE_SESSION = {
  id: "sess-1",
  roomCode: "ABCDE",
  roomId: "room-1",
  players: [
    { playerId: "p1", nickname: "Player 1", seatOrder: 0, isHost: true },
    { playerId: "p2", nickname: "Player 2", seatOrder: 1, isHost: false },
  ],
  createdAt: new Date(),
};

function makeReq(sessionId: string, playerId: string) {
  return new NextRequest(
    `http://localhost/api/debug/session/${sessionId}/as-player/${playerId}`
  );
}

function makeParams(sessionId: string, playerId: string) {
  return { params: Promise.resolve({ id: sessionId, playerId }) };
}

describe("GET /api/debug/session/[id]/as-player/[playerId]", () => {
  const OLD_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.env as Record<string, string>).NODE_ENV = "development";
  });

  afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = OLD_ENV;
  });

  it("returns 404 in production", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const res = await GET(makeReq("sess-1", "p1"), makeParams("sess-1", "p1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when session not found", async () => {
    const { DebugSessionNotFoundError } = await import("@/lib/debug/debug-service");
    mocks.getSession.mockImplementation(() => {
      throw new DebugSessionNotFoundError("sess-x");
    });
    const res = await GET(makeReq("sess-x", "p1"), makeParams("sess-x", "p1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when playerId not in session", async () => {
    mocks.getSession.mockReturnValue(FAKE_SESSION);
    const res = await GET(makeReq("sess-1", "p-unknown"), makeParams("sess-1", "p-unknown"));
    expect(res.status).toBe(404);
  });

  it("redirects to /room/[code]?debugPlayerId=... without setting a cookie", async () => {
    mocks.getSession.mockReturnValue(FAKE_SESSION);
    const res = await GET(makeReq("sess-1", "p1"), makeParams("sess-1", "p1"));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/room/ABCDE");
    expect(location).toContain("debugPlayerId=p1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

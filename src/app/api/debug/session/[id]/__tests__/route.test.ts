import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ getSessionState: mocks.getSessionState }),
  DebugSessionNotFoundError: class DebugSessionNotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "DebugSessionNotFoundError";
    }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "../route";

function makeReq(id: string) {
  return new NextRequest(`http://localhost/api/debug/session/${id}`);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/debug/session/[id]", () => {
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
    const res = await GET(makeReq("sess-1"), makeParams("sess-1"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when session not found", async () => {
    const { DebugSessionNotFoundError } = await import("@/lib/debug/debug-service");
    mocks.getSessionState.mockRejectedValue(new DebugSessionNotFoundError("x"));
    const res = await GET(makeReq("x"), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with session state", async () => {
    mocks.getSessionState.mockResolvedValue({
      sessionId: "sess-1",
      roomCode: "ABCDE",
      roomStatus: "lobby",
      currentRound: 0,
      numRounds: 3,
      players: [],
    });
    const res = await GET(makeReq("sess-1"), makeParams("sess-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.roomCode).toBe("ABCDE");
    expect(data.roomStatus).toBe("lobby");
  });
});

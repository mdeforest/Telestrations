import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ createSession: mocks.createSession }),
  DebugInvalidConfigError: class DebugInvalidConfigError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "DebugInvalidConfigError";
    }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "../route";

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/debug/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/debug/session", () => {
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
    const res = await POST(makeReq({ playerCount: 4 }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when playerCount is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when service throws DebugInvalidConfigError", async () => {
    const { DebugInvalidConfigError } = await import("@/lib/debug/debug-service");
    mocks.createSession.mockRejectedValue(new DebugInvalidConfigError("bad count"));
    const res = await POST(makeReq({ playerCount: 2 }));
    expect(res.status).toBe(400);
  });

  it("returns 201 with session data on success", async () => {
    mocks.createSession.mockResolvedValue({
      id: "sess-1",
      roomCode: "ABCDE",
      players: [{ playerId: "p1", nickname: "Player 1", seatOrder: 0, isHost: true }],
    });
    const res = await POST(makeReq({ playerCount: 4 }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sessionId).toBe("sess-1");
    expect(data.roomCode).toBe("ABCDE");
    expect(data.players).toHaveLength(1);
  });
});

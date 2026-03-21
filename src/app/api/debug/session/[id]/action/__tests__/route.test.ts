import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  performAction: vi.fn(),
}));

vi.mock("@/lib/debug/debug-service", () => ({
  createDebugService: () => ({ performAction: mocks.performAction }),
  DebugSessionNotFoundError: class DebugSessionNotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "DebugSessionNotFoundError";
    }
  },
  DebugInvalidActionError: class DebugInvalidActionError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "DebugInvalidActionError";
    }
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "../route";

function makeReq(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/debug/session/${id}/action`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/debug/session/[id]/action", () => {
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
    const res = await POST(makeReq("s", { action: "start_game" }), makeParams("s"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when action is missing", async () => {
    const res = await POST(makeReq("s", {}), makeParams("s"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when action is not a valid value", async () => {
    const res = await POST(makeReq("s", { action: "do_magic" }), makeParams("s"));
    expect(res.status).toBe(400);
  });

  it("returns 200 on successful action", async () => {
    mocks.performAction.mockResolvedValue(undefined);
    const res = await POST(makeReq("sess-1", { action: "start_game" }), makeParams("sess-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mocks.performAction).toHaveBeenCalledWith("sess-1", "start_game");
  });

  it("returns 404 when session not found", async () => {
    const { DebugSessionNotFoundError } = await import("@/lib/debug/debug-service");
    mocks.performAction.mockRejectedValue(new DebugSessionNotFoundError("x"));
    const res = await POST(makeReq("x", { action: "start_game" }), makeParams("x"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when action is invalid for current phase", async () => {
    const { DebugInvalidActionError } = await import("@/lib/debug/debug-service");
    mocks.performAction.mockRejectedValue(new DebugInvalidActionError("wrong phase"));
    const res = await POST(makeReq("s", { action: "advance_reveal" }), makeParams("s"));
    expect(res.status).toBe(400);
  });
});

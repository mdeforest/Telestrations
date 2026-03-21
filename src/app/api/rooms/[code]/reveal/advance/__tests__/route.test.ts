import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ─────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  advanceReveal: vi.fn(),
  ablyPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mocks.cookieGet }),
}));

vi.mock("@/lib/game/reveal-service", () => ({
  createRevealService: () => ({ advanceReveal: mocks.advanceReveal }),
  RoomNotFoundError: class RoomNotFoundError extends Error {
    constructor(msg: string) { super(msg); this.name = "RoomNotFoundError"; }
  },
  NotHostError: class NotHostError extends Error {
    constructor() { super("not host"); this.name = "NotHostError"; }
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
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the room does not exist", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    const { RoomNotFoundError } = await import("@/lib/game/reveal-service");
    mocks.advanceReveal.mockRejectedValue(new RoomNotFoundError("ABCDEF"));

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not the host", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-2" });
    const { NotHostError } = await import("@/lib/game/reveal-service");
    mocks.advanceReveal.mockRejectedValue(new NotHostError());

    const res = await POST(makeReq(), makeParams());
    expect(res.status).toBe(403);
  });

  it("returns 200 with updated indices on success", async () => {
    mocks.cookieGet.mockReturnValue({ value: "host-1" });
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
    mocks.cookieGet.mockReturnValue({ value: "host-1" });
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
});

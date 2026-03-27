// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "../route";
import { NextRequest } from "next/server";

function makeRequest() {
  return new NextRequest("http://localhost/api/rounds/round-1/drawing-status");
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ROUND_ID = "round-1";
const ROOM_ID = "room-1";
const BOOK_ID = "book-1";
const PLAYER_ID = "player-1";

const ROUND_ROW = { id: ROUND_ID, roomId: ROOM_ID, currentPass: 1, timerStartedAt: null };
const BOOK_ROW = { id: BOOK_ID, ownerPlayerId: PLAYER_ID };

// Helper to build a single db.select() mock return value
function makeSelectOnce(result: unknown) {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(result) }) };
}

describe("GET /api/rounds/[id]/drawing-status", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 404 when round not found", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn().mockReturnValue(makeSelectOnce([]));
    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    expect(res.status).toBe(404);
  });

  it("returns passType 'drawing' when current-pass entry type is drawing", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      // 1) rounds query
      .mockReturnValueOnce(makeSelectOnce([ROUND_ROW]))
      // 2) books query
      .mockReturnValueOnce(makeSelectOnce([BOOK_ROW]))
      // 3) merged passEntries query (type + authorPlayerId + submittedAt)
      .mockReturnValueOnce(makeSelectOnce([{ type: "drawing", authorPlayerId: PLAYER_ID, submittedAt: null }]))
      // 4) players
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("drawing");
  });

  it("returns passType 'guess' when current-pass entry type is guess", async () => {
    // currentPass value is irrelevant to route logic — the route reads `type` from the entry row,
    // not the pass number. Using currentPass: 1 here to avoid implying even passes = guess.
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      .mockReturnValueOnce(makeSelectOnce([ROUND_ROW]))
      .mockReturnValueOnce(makeSelectOnce([BOOK_ROW]))
      .mockReturnValueOnce(makeSelectOnce([{ type: "guess", authorPlayerId: PLAYER_ID, submittedAt: null }]))
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("guess");
  });

  it("falls back to 'drawing' when no entries exist for the current pass", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      .mockReturnValueOnce(makeSelectOnce([ROUND_ROW]))
      .mockReturnValueOnce(makeSelectOnce([BOOK_ROW]))
      .mockReturnValueOnce(makeSelectOnce([]))   // no entries yet
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("drawing");
  });

  it("falls back to 'drawing' when the round has no books yet", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      .mockReturnValueOnce(makeSelectOnce([ROUND_ROW]))
      // books query returns empty — no books in this round
      .mockReturnValueOnce(makeSelectOnce([]))
      // passEntries is short-circuited (bookIds.length === 0), so next call is players
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("drawing");
    expect(body.pendingNicknames).toEqual([]);
  });
});

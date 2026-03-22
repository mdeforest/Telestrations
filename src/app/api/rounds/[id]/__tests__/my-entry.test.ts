// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @/lib/debug/get-player-id ────────────────────────────────────────────
const { mockGetPlayerId } = vi.hoisted(() => ({ mockGetPlayerId: vi.fn() }));
vi.mock("@/lib/debug/get-player-id", () => ({
  getPlayerId: mockGetPlayerId,
}));

// ── Mock @/lib/db ─────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({ db: {} }));

// ── Mock Drizzle operators (used in the route but not relevant here) ──────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual };
});

import { GET } from "../my-entry/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/rounds/round-1/my-entry");
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function mockCookies(playerId: string | undefined) {
  mockGetPlayerId.mockResolvedValue(playerId);
}

// ── Test data ─────────────────────────────────────────────────────────────────

const ROUND_ID = "round-1";
const BOOK_ID = "book-1";
const PLAYER_ID = "player-1";
const ORIGINAL_PROMPT = "a fire-breathing cat";

const ROUND_ROW = { id: ROUND_ID, roomId: "room-1", currentPass: 2 };

const DRAWING_ENTRY = {
  bookId: BOOK_ID,
  passNumber: 1,
  submittedAt: new Date(),
  type: "drawing",
  content: JSON.stringify([{ x: 0, y: 0 }]),
};

const GUESS_ENTRY = {
  bookId: BOOK_ID,
  passNumber: 2,
  submittedAt: null,
  type: "guess",
  content: "",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/rounds/[id]/my-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockCookies(undefined);
    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    expect(res.status).toBe(401);
  });

  it("returns originalPrompt as incomingContent for a drawing pass 1 entry", async () => {
    mockCookies(PLAYER_ID);

    const { db } = await import("@/lib/db");
    const selectMock = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROUND_ROW]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { bookId: BOOK_ID, passNumber: 1, submittedAt: null, type: "drawing" },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        // books query for originalPrompt
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ originalPrompt: ORIGINAL_PROMPT }]),
        }),
      });

    (db as unknown as Record<string, unknown>).select = selectMock;

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("drawing");
    expect(body.incomingContent).toBe(ORIGINAL_PROMPT);
  });

  it("returns previous guess as incomingContent for a drawing pass 3+ entry", async () => {
    mockCookies(PLAYER_ID);

    const GUESS_TEXT = "a volcano shark";
    const ROUND_ROW_PASS3 = { ...ROUND_ROW, currentPass: 3 };

    const { db } = await import("@/lib/db");
    const selectMock = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROUND_ROW_PASS3]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { bookId: BOOK_ID, passNumber: 3, submittedAt: null, type: "drawing" },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        // previous-pass guess query
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ content: GUESS_TEXT }]),
        }),
      });

    (db as unknown as Record<string, unknown>).select = selectMock;

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("drawing");
    expect(body.incomingContent).toBe(GUESS_TEXT);
  });

  it("returns type and incomingContent for a guess-pass entry", async () => {
    mockCookies(PLAYER_ID);

    const { db } = await import("@/lib/db");
    const selectMock = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([ROUND_ROW]),
        }),
      })
      .mockReturnValueOnce({
        // my-entry query (guess)
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([GUESS_ENTRY]),
          }),
        }),
      })
      .mockReturnValueOnce({
        // previous-pass content query
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([DRAWING_ENTRY]),
        }),
      });

    (db as unknown as Record<string, unknown>).select = selectMock;

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("guess");
    expect(body.incomingContent).toBe(DRAWING_ENTRY.content);
  });
});

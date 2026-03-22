import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getPlayerId: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
}));

vi.mock("@/lib/debug/get-player-id", () => ({
  getPlayerId: mocks.getPlayerId,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
    update: mocks.dbUpdate,
  },
}));

// Import AFTER mocks
import { PATCH } from "../route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/entries/entry-1/override", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeParams(id = "entry-1") {
  return { params: Promise.resolve({ id }) };
}

const OWNER_PLAYER_ID = "player-owner";
const OTHER_PLAYER_ID = "player-other";
const ENTRY_ID = "entry-1";
const BOOK_ID = "book-1";

const ENTRY_ROW = {
  id: ENTRY_ID,
  bookId: BOOK_ID,
  passNumber: 2,
  authorPlayerId: OTHER_PLAYER_ID,
  type: "guess" as const,
  fuzzyCorrect: false,
  ownerOverride: null,
};

const BOOK_ROW = {
  id: BOOK_ID,
  ownerPlayerId: OWNER_PLAYER_ID,
  originalPrompt: "A cat",
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PATCH /api/entries/[id]/override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when playerId cookie is missing", async () => {
    mocks.getPlayerId.mockResolvedValue(undefined);
    const res = await PATCH(makeReq({ correct: true }), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 400 when 'correct' field is missing", async () => {
    mocks.getPlayerId.mockResolvedValue(OWNER_PLAYER_ID);
    const res = await PATCH(makeReq({}), makeParams());
    expect(res.status).toBe(400);
  });

  it("returns 400 when 'correct' is not a boolean", async () => {
    mocks.getPlayerId.mockResolvedValue(OWNER_PLAYER_ID);
    const res = await PATCH(makeReq({ correct: "yes" }), makeParams());
    expect(res.status).toBe(400);
  });

  it("returns 404 when the entry does not exist", async () => {
    mocks.getPlayerId.mockResolvedValue(OWNER_PLAYER_ID);

    // Entry lookup → not found
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }));

    const res = await PATCH(makeReq({ correct: true }), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the book does not exist", async () => {
    mocks.getPlayerId.mockResolvedValue(OWNER_PLAYER_ID);

    // Entry lookup → found
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([ENTRY_ROW]),
      }),
    }));

    // Book lookup → not found
    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }));

    const res = await PATCH(makeReq({ correct: true }), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not the book owner", async () => {
    mocks.getPlayerId.mockResolvedValue(OTHER_PLAYER_ID); // not the owner

    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([ENTRY_ROW]),
      }),
    }));

    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([BOOK_ROW]),
      }),
    }));

    const res = await PATCH(makeReq({ correct: true }), makeParams());
    expect(res.status).toBe(403);
  });

  it("sets ownerOverride: true on the entry and returns 200", async () => {
    mocks.getPlayerId.mockResolvedValue(OWNER_PLAYER_ID);

    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([ENTRY_ROW]),
      }),
    }));

    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([BOOK_ROW]),
      }),
    }));

    const UPDATED_ENTRY = { ...ENTRY_ROW, ownerOverride: true };
    mocks.dbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([UPDATED_ENTRY]),
        }),
      }),
    });

    const res = await PATCH(makeReq({ correct: true }), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entry).toMatchObject({ id: ENTRY_ID, ownerOverride: true });
  });

  it("sets ownerOverride: false to mark a fuzzy-correct guess as incorrect", async () => {
    mocks.getPlayerId.mockResolvedValue(OWNER_PLAYER_ID);

    const fuzzyCorrectEntry = { ...ENTRY_ROW, fuzzyCorrect: true };

    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([fuzzyCorrectEntry]),
      }),
    }));

    mocks.dbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([BOOK_ROW]),
      }),
    }));

    const UPDATED_ENTRY = { ...fuzzyCorrectEntry, ownerOverride: false };
    mocks.dbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([UPDATED_ENTRY]),
        }),
      }),
    });

    const res = await PATCH(makeReq({ correct: false }), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.entry).toMatchObject({ ownerOverride: false });
  });
});

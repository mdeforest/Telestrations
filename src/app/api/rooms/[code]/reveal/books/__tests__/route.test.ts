import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ─────────────────────────────────────────────────
//
// `terminal` is the single mock called at the end of EVERY DB query chain:
//   - await select().from().where()                              → terminal() via thenable.then
//   - await select().from().where().orderBy()                    → terminal() via orderBy()
//   - await select().from().innerJoin().innerJoin().where().orderBy() → terminal() via orderBy()
//   - await select().from().innerJoin().where().orderBy()        → terminal() via orderBy()
//
// Queue responses with terminal.mockResolvedValueOnce([...]) in call order.

const mocks = vi.hoisted(() => ({
  getPlayerId: vi.fn(),
  terminal: vi.fn(),
}));

vi.mock("@/lib/debug/get-player-id", () => ({
  getPlayerId: mocks.getPlayerId,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // Shape: select().from().where() — thenable + optional .orderBy()
        where: vi.fn().mockReturnValue({
          then: (res: (v: unknown) => unknown, rej?: (r: unknown) => unknown) =>
            mocks.terminal().then(res, rej),
          catch: (rej: (r: unknown) => unknown) => mocks.terminal().catch(rej),
          orderBy: vi.fn().mockImplementation(() => mocks.terminal()),
        }),
        // Shape: select().from().innerJoin().innerJoin().where().orderBy()
        //        select().from().innerJoin().where().orderBy()
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockImplementation(() => mocks.terminal()),
            }),
          }),
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => mocks.terminal()),
          }),
        }),
      }),
    }),
  },
}));

// Import AFTER mocks
import { GET } from "../route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(code = "ABCDEF") {
  return new NextRequest(`http://localhost/api/rooms/${code}/reveal/books`);
}

function makeParams(code = "ABCDEF") {
  return { params: Promise.resolve({ code }) };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const ROOM = {
  id: "room-1",
  code: "ABCDEF",
  status: "reveal",
  currentRound: 0,
  revealBookIndex: 1,
  revealEntryIndex: 2,
};

const ROUND = { id: "round-1", roomId: "room-1", roundNumber: 1 };

const BOOK = {
  id: "book-1",
  roundId: "round-1",
  ownerPlayerId: "player-1",
  originalPrompt: "A cat",
  ownerNickname: "Alice",
  ownerSeatOrder: 1,
  roundNumber: 1,
};

const ENTRY = {
  id: "entry-1",
  bookId: "book-1",
  passNumber: 1,
  type: "drawing",
  content: "{}",
  authorPlayerId: "player-1",
  authorNickname: "Alice",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/rooms/[code]/reveal/books", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.terminal.mockReset();
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  it("returns 401 when playerId cookie is missing", async () => {
    mocks.getPlayerId.mockResolvedValue(undefined);
    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(401);
  });

  // ── Room not found ──────────────────────────────────────────────────────────
  it("returns 404 when room does not exist", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");
    mocks.terminal.mockResolvedValueOnce([]); // room lookup → empty

    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(404);
  });

  // ── Current round not found ─────────────────────────────────────────────────
  it("returns empty books array when current round is not found", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");
    mocks.terminal.mockResolvedValueOnce([ROOM]); // room
    mocks.terminal.mockResolvedValueOnce([]);     // current round lookup → empty

    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.books).toEqual([]);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────
  it("returns books with entries and current reveal indices", async () => {
    mocks.getPlayerId.mockResolvedValue("player-1");
    mocks.terminal.mockResolvedValueOnce([ROOM]);   // room
    mocks.terminal.mockResolvedValueOnce([ROUND]);  // rounds
    mocks.terminal.mockResolvedValueOnce([BOOK]);   // books (double join)
    mocks.terminal.mockResolvedValueOnce([ENTRY]);  // entries (single join)

    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.revealBookIndex).toBe(1);
    expect(body.revealEntryIndex).toBe(2);
    expect(body.status).toBe("reveal");
    expect(body.books).toHaveLength(1);
    expect(body.books[0].id).toBe("book-1");
    expect(body.books[0].originalPrompt).toBe("A cat");
    expect(body.books[0].ownerNickname).toBe("Alice");
    expect(body.books[0].entries).toHaveLength(1);
    expect(body.books[0].entries[0].id).toBe("entry-1");
  });

  it("scopes books to current round (uses room.currentRound)", async () => {
    // Room in round 2 — only round 2's books should be in the response
    const roomRound2 = { ...ROOM, currentRound: 2 };
    const round2 = { id: "round-2", roomId: "room-1", roundNumber: 2 };
    const bookRound2 = { ...BOOK, id: "book-r2", roundId: "round-2", roundNumber: 2 };
    const entryRound2 = { ...ENTRY, id: "entry-r2", bookId: "book-r2" };

    mocks.getPlayerId.mockResolvedValue("player-1");
    mocks.terminal.mockResolvedValueOnce([roomRound2]);
    mocks.terminal.mockResolvedValueOnce([round2]);
    mocks.terminal.mockResolvedValueOnce([bookRound2]);
    mocks.terminal.mockResolvedValueOnce([entryRound2]);

    const res = await GET(makeReq(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.books).toHaveLength(1);
    expect(body.books[0].id).toBe("book-r2");
  });

  it("groups entries by book correctly", async () => {
    const BOOK_2 = { ...BOOK, id: "book-2", ownerPlayerId: "player-2", ownerNickname: "Bob", ownerSeatOrder: 2 };
    const ENTRY_2 = { ...ENTRY, id: "entry-2", bookId: "book-2" };

    mocks.getPlayerId.mockResolvedValue("player-1");
    mocks.terminal.mockResolvedValueOnce([ROOM]);
    mocks.terminal.mockResolvedValueOnce([ROUND]);
    mocks.terminal.mockResolvedValueOnce([BOOK, BOOK_2]);
    mocks.terminal.mockResolvedValueOnce([ENTRY, ENTRY_2]);

    const res = await GET(makeReq(), makeParams());
    const body = await res.json();

    expect(body.books).toHaveLength(2);
    expect(body.books[0].entries).toHaveLength(1);
    expect(body.books[0].entries[0].id).toBe("entry-1");
    expect(body.books[1].entries).toHaveLength(1);
    expect(body.books[1].entries[0].id).toBe("entry-2");
  });
});

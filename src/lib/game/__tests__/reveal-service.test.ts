import { describe, it, expect, vi } from "vitest";
import {
  createRevealService,
  NotHostError,
  NotRevealPhaseError,
  RoomNotFoundError,
} from "../reveal-service";

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a select mock that returns responses in sequence.
 * Handles these query shapes used by the reveal service:
 *   1. select().from().where()                                        → awaitable
 *   2. select().from().innerJoin().innerJoin().where().orderBy()      → awaitable
 *   3. select().from().where().orderBy()                              → awaitable
 */
function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;

  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      // Shape 1 & 3: from().where() — thenable + optional .orderBy()
      where: vi.fn().mockImplementation(() => {
        const resp = responses[callIdx++] ?? [];
        const thenable = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then: (res: (value: unknown) => unknown, rej?: (reason: unknown) => unknown) => Promise.resolve(resp).then(res as any, rej as any),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          catch: (rej: (reason: unknown) => unknown) => Promise.resolve(resp).catch(rej as any),
          orderBy: vi.fn().mockReturnValue(Promise.resolve(resp)),
        };
        return thenable;
      }),
      // Shape 2: from().innerJoin().innerJoin().where().orderBy()
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            const resp = responses[callIdx++] ?? [];
            return {
              orderBy: vi.fn().mockReturnValue(Promise.resolve(resp)),
            };
          }),
        }),
      }),
    }),
  }));
}

/** Tracking update mock — records every .set() call. */
function makeTrackingUpdateMock() {
  const setCalls: Array<Record<string, unknown>> = [];
  const mock = vi.fn().mockReturnValue({
    set: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      setCalls.push(vals);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{}]),
        }),
      };
    }),
  });
  return { mock, setCalls };
}

// ── Test data ────────────────────────────────────────────────────────────────

const ROOM_ID = "room-1";
const ROOM_CODE = "ABCDEF";
const HOST_ID = "host-player-1";
const WRONG_PLAYER_ID = "player-99";
const ROUND_1_ID = "round-1";
const ROUND_2_ID = "round-2";

const BOOK_1_ID = "book-1";
const BOOK_2_ID = "book-2";

// Room at the very start of reveal (book 0, entry 0), currentRound=0 → round 1
const ROOM_ROW = {
  id: ROOM_ID,
  code: ROOM_CODE,
  status: "reveal" as const,
  hostPlayerId: HOST_ID,
  currentRound: 0,
  numRounds: 1,
  revealBookIndex: 0,
  revealEntryIndex: 0,
};

// Ordered list of books for round 1 only
const ALL_BOOKS = [
  { id: BOOK_1_ID, roundNumber: 1, seatOrder: 1 },
  { id: BOOK_2_ID, roundNumber: 1, seatOrder: 2 },
];

// Entries for book 1 (3 entries: prompt → drawing → guess)
const BOOK_1_ENTRIES = [
  { id: "entry-1", bookId: BOOK_1_ID, passNumber: 1, type: "drawing", content: '{"strokes":[]}' },
  { id: "entry-2", bookId: BOOK_1_ID, passNumber: 2, type: "guess", content: "a cat" },
  { id: "entry-3", bookId: BOOK_1_ID, passNumber: 3, type: "drawing", content: '{"strokes":[]}' },
];

// Entries for book 2
const BOOK_2_ENTRIES = [
  { id: "entry-4", bookId: BOOK_2_ID, passNumber: 1, type: "drawing", content: '{}' },
  { id: "entry-5", bookId: BOOK_2_ID, passNumber: 2, type: "guess", content: "a dog" },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("advanceReveal", () => {
  // ── Tracer bullet ───────────────────────────────────────────────────────────
  it("increments revealEntryIndex when not at end of current book", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    // Room at entry 0 of 3 → advance to entry 1
    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],       // fetch room by code
        ALL_BOOKS,        // fetch ordered books
        BOOK_1_ENTRIES,   // fetch entries for current book
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    expect(result.revealBookIndex).toBe(0);
    expect(result.revealEntryIndex).toBe(1);
    expect(result.finished).toBe(false);
    expect(setCalls[0]).toMatchObject({ revealEntryIndex: 1 });
  });

  // ── Authorization ───────────────────────────────────────────────────────────
  it("throws RoomNotFoundError when no room matches the code", async () => {
    const db = {
      select: makeSelectSequence([[]]), // room not found
      update: vi.fn(),
    };

    const service = createRevealService(db as never);
    await expect(service.advanceReveal("XXXXXX", HOST_ID)).rejects.toThrow(RoomNotFoundError);
  });

  it("throws NotHostError when the caller is not the host", async () => {
    const db = {
      select: makeSelectSequence([[ROOM_ROW]]),
      update: vi.fn(),
    };

    const service = createRevealService(db as never);
    await expect(service.advanceReveal(ROOM_CODE, WRONG_PLAYER_ID)).rejects.toThrow(NotHostError);
  });

  it("throws NotRevealPhaseError when room is not in reveal status", async () => {
    const activeRoom = { ...ROOM_ROW, status: "active" as const };
    const db = {
      select: makeSelectSequence([[activeRoom]]),
      update: vi.fn(),
    };

    const service = createRevealService(db as never);
    await expect(service.advanceReveal(ROOM_CODE, HOST_ID)).rejects.toThrow(NotRevealPhaseError);
  });

  // ── Book transition ──────────────────────────────────────────────────────────
  it("moves to next book (resets entry index) when at last entry of current book", async () => {
    // Room at last entry of book 0 (entryIndex = 2 = last of 3 entries)
    const roomAtLastEntry = { ...ROOM_ROW, revealEntryIndex: 2 };
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [roomAtLastEntry],
        ALL_BOOKS,
        BOOK_1_ENTRIES, // 3 entries → index 2 is last
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    expect(result.revealBookIndex).toBe(1);
    expect(result.revealEntryIndex).toBe(0);
    expect(result.finished).toBe(false);
    expect(setCalls[0]).toMatchObject({ revealBookIndex: 1, revealEntryIndex: 0 });
  });

  // ── Game end (single-round or final round) ───────────────────────────────────
  it("marks game finished when at last entry of last book in the final round", async () => {
    // Room at book 1 (last book), entry 1 (last entry of book 2 which has 2 entries)
    // numRounds=1 → this IS the last round
    const roomAtEnd = { ...ROOM_ROW, revealBookIndex: 1, revealEntryIndex: 1, numRounds: 1 };
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [roomAtEnd],
        ALL_BOOKS,
        BOOK_2_ENTRIES, // 2 entries → index 1 is last
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    expect(result.finished).toBe(true);
    expect(result.nextRound).toBe(false);
    expect(setCalls[0]).toMatchObject({ status: "finished" });
  });

  // ── Return values ────────────────────────────────────────────────────────────
  it("returns current indices (unchanged) when marking finished", async () => {
    const roomAtEnd = { ...ROOM_ROW, revealBookIndex: 1, revealEntryIndex: 1, numRounds: 1 };
    const { mock: updateMock } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [roomAtEnd],
        ALL_BOOKS,
        BOOK_2_ENTRIES,
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    expect(result.revealBookIndex).toBe(1);
    expect(result.revealEntryIndex).toBe(1);
  });

  // ── Out-of-bounds defence ────────────────────────────────────────────────────
  it("returns finished:true and marks room finished when revealBookIndex is out of bounds", async () => {
    // Room thinks it's on book 99 but only 2 books exist — stale/corrupt state
    const roomOutOfBounds = { ...ROOM_ROW, revealBookIndex: 99, revealEntryIndex: 0, numRounds: 1 };
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [roomOutOfBounds],
        ALL_BOOKS, // only 2 books, index 99 is undefined
        // no entries query — should short-circuit before reaching it
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    expect(result.finished).toBe(true);
    expect(setCalls[0]).toMatchObject({ status: "finished" });
  });

  // ── Multi-round transition ────────────────────────────────────────────────────
  it("transitions to prompts for next round when all books revealed and more rounds remain", async () => {
    // Room at last entry of last book, but numRounds=2 → more rounds remain
    // currentRound=0 → round 1 just revealed; next round is round 2
    const roomAtEndOfRound1 = {
      ...ROOM_ROW,
      revealBookIndex: 1,
      revealEntryIndex: 1,
      currentRound: 0,
      numRounds: 2,
    };
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const ROUND_2_ROW = { id: ROUND_2_ID };

    const db = {
      select: makeSelectSequence([
        [roomAtEndOfRound1],    // room
        ALL_BOOKS,              // books for round 1
        BOOK_2_ENTRIES,         // entries for last book
        [ROUND_2_ROW],          // next round lookup
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    expect(result.finished).toBe(false);
    expect(result.nextRound).toBe(true);
    expect(result.nextRoundId).toBe(ROUND_2_ID);
    expect(setCalls[0]).toMatchObject({
      status: "prompts",
      currentRound: 2,
      revealBookIndex: 0,
      revealEntryIndex: 0,
    });
  });

  it("scopes book query to the current round (not all rounds)", async () => {
    // currentRound=2 → should only see round 2's books, not round 1's
    const roomInRound2 = {
      ...ROOM_ROW,
      currentRound: 2,
      numRounds: 2,
      revealBookIndex: 0,
      revealEntryIndex: 0,
    };
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const ROUND_2_BOOKS = [{ id: "book-r2", roundNumber: 2, seatOrder: 1 }];
    // Two entries so there is something to advance to from index 0
    const ROUND_2_BOOK_ENTRIES = [
      { id: "e1", bookId: "book-r2", passNumber: 1, type: "drawing", content: "" },
      { id: "e2", bookId: "book-r2", passNumber: 2, type: "guess", content: "cat" },
    ];

    const db = {
      select: makeSelectSequence([
        [roomInRound2],
        ROUND_2_BOOKS,        // only round 2's books
        ROUND_2_BOOK_ENTRIES, // 2 entries → can advance from 0 to 1
      ]),
      update: updateMock,
    };

    const service = createRevealService(db as never);
    const result = await service.advanceReveal(ROOM_CODE, HOST_ID);

    // Advances to entry 1 (from 0)
    expect(result.revealEntryIndex).toBe(1);
    expect(setCalls[0]).toMatchObject({ revealEntryIndex: 1 });
  });
});

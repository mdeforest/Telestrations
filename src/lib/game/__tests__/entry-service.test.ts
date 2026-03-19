import { describe, it, expect, vi } from "vitest";
import {
  createEntryService,
  WrongAuthorError,
  AlreadySubmittedError,
  ContentTooLargeError,
  EntryNotFoundError,
} from "../entry-service";

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a select mock that returns responses in sequence.
 * Handles `select().from().where()` and `select().from().where().innerJoin()` etc.
 */
function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const resp = responses[callIdx++] ?? [];
        // Support chained .innerJoin().where() by returning a thenable that also has chainable methods
        const thenable = Promise.resolve(resp);
        return thenable;
      }),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(responses[callIdx++] ?? [])),
      }),
    }),
  }));
}

/**
 * Tracking update mock — records every `.set()` call for assertions.
 */
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

const ENTRY_ID = "entry-1";
const BOOK_ID = "book-1";
const ROUND_ID = "round-1";
const ROOM_ID = "room-1";
const PLAYER_ID = "player-1";
const WRONG_PLAYER_ID = "player-99";
const PASS_NUMBER = 1;
const VALID_CONTENT = JSON.stringify([{ x: 0, y: 0 }]); // small drawing JSON

const ENTRY_ROW = {
  id: ENTRY_ID,
  bookId: BOOK_ID,
  passNumber: PASS_NUMBER,
  authorPlayerId: PLAYER_ID,
  type: "drawing" as const,
  content: "",
  submittedAt: null,
  isBlank: false,
};

const ROUND_ROW = {
  id: ROUND_ID,
  roomId: ROOM_ID,
  roundNumber: 1,
  currentPass: PASS_NUMBER,
  timerStartedAt: null,
};

const BOOK_ROW = {
  id: BOOK_ID,
  roundId: ROUND_ID,
  ownerPlayerId: PLAYER_ID,
  originalPrompt: "A cat",
};

// ── submitEntry — tracer bullet ───────────────────────────────────────────────

describe("submitEntry", () => {
  it("saves content and submitted_at for a valid submission", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    // Sequence: entry → book → count (not zero, so no advance)
    const db = {
      select: makeSelectSequence([
        [ENTRY_ROW],          // find entry by bookId + passNumber
        [BOOK_ROW],           // look up book to get roundId
        [{ count: 1 }],       // unsubmitted entries remaining (not 0 yet)
      ]),
      update: updateMock,
    };

    const service = createEntryService(db as never);
    await service.submitEntry(BOOK_ID, PASS_NUMBER, PLAYER_ID, VALID_CONTENT);

    expect(setCalls[0]).toMatchObject({ content: VALID_CONTENT });
    expect(setCalls[0]?.submittedAt).toBeInstanceOf(Date);
  });

  it("throws EntryNotFoundError when no entry exists for bookId+passNumber", async () => {
    const db = {
      select: makeSelectSequence([[]]), // no entry found
      update: vi.fn(),
    };

    const service = createEntryService(db as never);
    await expect(
      service.submitEntry(BOOK_ID, PASS_NUMBER, PLAYER_ID, VALID_CONTENT)
    ).rejects.toThrow(EntryNotFoundError);
  });

  it("throws WrongAuthorError when the submitting player is not the entry author", async () => {
    const db = {
      select: makeSelectSequence([[ENTRY_ROW]]),
      update: vi.fn(),
    };

    const service = createEntryService(db as never);
    await expect(
      service.submitEntry(BOOK_ID, PASS_NUMBER, WRONG_PLAYER_ID, VALID_CONTENT)
    ).rejects.toThrow(WrongAuthorError);
  });

  it("throws AlreadySubmittedError when the entry has already been submitted", async () => {
    const alreadySubmitted = { ...ENTRY_ROW, submittedAt: new Date() };
    const db = {
      select: makeSelectSequence([[alreadySubmitted]]),
      update: vi.fn(),
    };

    const service = createEntryService(db as never);
    await expect(
      service.submitEntry(BOOK_ID, PASS_NUMBER, PLAYER_ID, VALID_CONTENT)
    ).rejects.toThrow(AlreadySubmittedError);
  });

  it("throws ContentTooLargeError when drawing JSON exceeds 500KB", async () => {
    const oversized = "x".repeat(500_001);
    const db = {
      select: makeSelectSequence([[ENTRY_ROW]]),
      update: vi.fn(),
    };

    const service = createEntryService(db as never);
    await expect(
      service.submitEntry(BOOK_ID, PASS_NUMBER, PLAYER_ID, oversized)
    ).rejects.toThrow(ContentTooLargeError);
  });

  it("returns allSubmitted: false when other entries in the pass are still pending", async () => {
    const { mock: updateMock } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [ENTRY_ROW],
        [BOOK_ROW],
        [{ count: 3 }], // 3 others still pending
      ]),
      update: updateMock,
    };

    const service = createEntryService(db as never);
    const result = await service.submitEntry(BOOK_ID, PASS_NUMBER, PLAYER_ID, VALID_CONTENT);

    expect(result.allSubmitted).toBe(false);
  });

  it("returns allSubmitted: true and advances the pass when all entries are submitted", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    // Sequence: entry → book → count=0 → round
    const db = {
      select: makeSelectSequence([
        [ENTRY_ROW],
        [BOOK_ROW],       // look up book to find roundId
        [{ count: 0 }],   // no more pending entries — all submitted
        [ROUND_ROW],      // load round row to know currentPass
      ]),
      update: updateMock,
    };

    const service = createEntryService(db as never);
    const result = await service.submitEntry(BOOK_ID, PASS_NUMBER, PLAYER_ID, VALID_CONTENT);

    expect(result.allSubmitted).toBe(true);
    // Second update call advances currentPass and resets timer
    expect(setCalls[1]).toMatchObject({
      currentPass: PASS_NUMBER + 1,
    });
    expect(setCalls[1]?.timerStartedAt).toBeInstanceOf(Date);
  });
});

// ── expirePass ────────────────────────────────────────────────────────────────

describe("expirePass", () => {
  it("blanks all unsubmitted entries for the current pass", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [ROUND_ROW],  // load round
        [BOOK_ROW],   // load books in the round (for round-scoped blank)
      ]),
      update: updateMock,
    };

    const service = createEntryService(db as never);
    await service.expirePass(ROUND_ID);

    // First update: blank unsubmitted entries
    expect(setCalls[0]).toMatchObject({ isBlank: true });
  });

  it("advances the pass after blanking", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [ROUND_ROW],  // load round
        [BOOK_ROW],   // load books in the round
      ]),
      update: updateMock,
    };

    const service = createEntryService(db as never);
    await service.expirePass(ROUND_ID);

    // Second update: advance currentPass + set timerStartedAt
    expect(setCalls[1]).toMatchObject({
      currentPass: PASS_NUMBER + 1,
    });
    expect(setCalls[1]?.timerStartedAt).toBeInstanceOf(Date);
  });

  it("skips blanking entries when the round has no books — guarding against inArray([]) crash", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [ROUND_ROW],  // load round
        [],           // no books in this round
      ]),
      update: updateMock,
    };

    const service = createEntryService(db as never);
    await service.expirePass(ROUND_ID);

    // Only the round-advance update should happen, not the entry-blank update
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toMatchObject({ currentPass: PASS_NUMBER + 1 });
  });
});

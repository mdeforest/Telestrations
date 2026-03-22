import { describe, it, expect, vi } from "vitest";
import {
  createCompetitiveScoreService,
  NoRoomFoundError,
} from "../competitive-score-service";

// ── Mock helpers ──────────────────────────────────────────────────────────────

/**
 * Index-based select mock supporting:
 *   select().from().where()
 *   select().from().innerJoin()...where()...groupBy()...orderBy()
 */
function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;

  function makeTerminal() {
    const resp = responses[callIdx++] ?? [];
    return {
      then: (res: (v: unknown) => unknown, rej?: (r: unknown) => unknown) =>
        Promise.resolve(resp).then(res as never, rej as never),
      catch: (rej: (r: unknown) => unknown) =>
        Promise.resolve(resp).catch(rej as never),
      groupBy: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue(Promise.resolve(resp)),
      }),
      orderBy: vi.fn().mockReturnValue(Promise.resolve(resp)),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeJoinChain(): any {
    return {
      innerJoin: vi.fn().mockImplementation(() => makeJoinChain()),
      where: vi.fn().mockImplementation(() => makeTerminal()),
    };
  }

  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => makeTerminal()),
      innerJoin: vi.fn().mockImplementation(() => makeJoinChain()),
    }),
  }));
}

function makeInsertMock(returning: unknown[] = []) {
  const valuesCalls: unknown[] = [];
  const mock = vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((v: unknown) => {
      valuesCalls.push(v);
      return { returning: vi.fn().mockResolvedValue(returning) };
    }),
  });
  return { mock, valuesCalls };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const ROOM_ID = "room-1";
const ROUND_ID = "round-1";
const BOOK_ID = "book-1";

const OWNER_PLAYER_ID = "player-owner";
const GUESSER_PLAYER_ID = "player-guesser";
const ARTIST_PLAYER_ID = "player-artist";

const ROOM_ROW = { id: ROOM_ID, scoringMode: "competitive" };

// A guess entry that was marked correct by fuzzy match
const GUESS_ENTRY = {
  id: "entry-guess-1",
  bookId: BOOK_ID,
  passNumber: 2,
  authorPlayerId: GUESSER_PLAYER_ID,
  type: "guess" as const,
  content: "a cat",
  fuzzyCorrect: true,
  ownerOverride: null,
};

// The drawing entry that preceded the correct guess (passNumber = 1)
const DRAWING_ENTRY = {
  id: "entry-draw-1",
  bookId: BOOK_ID,
  passNumber: 1,
  authorPlayerId: ARTIST_PLAYER_ID,
  type: "drawing" as const,
  content: "",
  fuzzyCorrect: null,
  ownerOverride: null,
};

const BOOK_ROW = {
  id: BOOK_ID,
  roundId: ROUND_ID,
  ownerPlayerId: OWNER_PLAYER_ID,
  originalPrompt: "A cat",
};

// ── tallyCompetitiveScores ────────────────────────────────────────────────────

describe("tallyCompetitiveScores", () => {
  it("throws NoRoomFoundError when room does not exist", async () => {
    const db = { select: makeSelectSequence([[]]) };
    const service = createCompetitiveScoreService(db as never);
    await expect(service.tallyCompetitiveScores(ROOM_ID)).rejects.toThrow(
      NoRoomFoundError
    );
  });

  it("returns empty array when there are no correct guesses", async () => {
    const incorrectGuess = { ...GUESS_ENTRY, fuzzyCorrect: false };

    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],          // room lookup
        [incorrectGuess],    // guess entries with fuzzyCorrect evaluated
      ]),
      insert: makeInsertMock([]).mock,
    };

    const service = createCompetitiveScoreService(db as never);
    const result = await service.tallyCompetitiveScores(ROOM_ID);

    expect(result).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("writes correct_guess + drawing_credited rows for a fuzzy-correct guess", async () => {
    const SCORE_ROWS = [
      { id: "score-1", playerId: GUESSER_PLAYER_ID, reason: "correct_guess" },
      { id: "score-2", playerId: ARTIST_PLAYER_ID, reason: "drawing_credited" },
    ];
    const { mock: insertMock, valuesCalls } = makeInsertMock(SCORE_ROWS);

    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],          // room lookup
        [GUESS_ENTRY],       // correct guess entries
        [DRAWING_ENTRY],     // preceding drawing for each correct guess
      ]),
      insert: insertMock,
    };

    const service = createCompetitiveScoreService(db as never);
    const result = await service.tallyCompetitiveScores(ROOM_ID);

    expect(insertMock).toHaveBeenCalledOnce();
    expect(result).toHaveLength(2);

    // Two score rows were submitted
    const inserted = valuesCalls[0] as Array<{
      playerId: string;
      reason: string;
    }>;
    expect(inserted).toHaveLength(2);
    expect(inserted).toContainEqual(
      expect.objectContaining({
        playerId: GUESSER_PLAYER_ID,
        reason: "correct_guess",
      })
    );
    expect(inserted).toContainEqual(
      expect.objectContaining({
        playerId: ARTIST_PLAYER_ID,
        reason: "drawing_credited",
      })
    );
  });

  it("respects ownerOverride: true over fuzzyCorrect: false", async () => {
    const overriddenToCorrect = {
      ...GUESS_ENTRY,
      fuzzyCorrect: false,
      ownerOverride: true,
    };

    const SCORE_ROWS = [
      { id: "score-1", playerId: GUESSER_PLAYER_ID, reason: "correct_guess" },
      { id: "score-2", playerId: ARTIST_PLAYER_ID, reason: "drawing_credited" },
    ];
    const { mock: insertMock } = makeInsertMock(SCORE_ROWS);

    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],
        [overriddenToCorrect],
        [DRAWING_ENTRY],
      ]),
      insert: insertMock,
    };

    const service = createCompetitiveScoreService(db as never);
    const result = await service.tallyCompetitiveScores(ROOM_ID);

    expect(result).toHaveLength(2);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("respects ownerOverride: false over fuzzyCorrect: true (marks incorrect)", async () => {
    const overriddenToIncorrect = {
      ...GUESS_ENTRY,
      fuzzyCorrect: true,
      ownerOverride: false,
    };

    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],
        [overriddenToIncorrect],
      ]),
      insert: makeInsertMock([]).mock,
    };

    const service = createCompetitiveScoreService(db as never);
    const result = await service.tallyCompetitiveScores(ROOM_ID);

    expect(result).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("handles multiple books with correct guesses independently", async () => {
    const GUESSER_2 = "player-guesser-2";
    const ARTIST_2 = "player-artist-2";
    const BOOK_2_ID = "book-2";

    const guessEntries = [
      GUESS_ENTRY,
      {
        id: "entry-guess-2",
        bookId: BOOK_2_ID,
        passNumber: 2,
        authorPlayerId: GUESSER_2,
        type: "guess" as const,
        content: "dog",
        fuzzyCorrect: true,
        ownerOverride: null,
      },
    ];

    const DRAWING_2 = {
      id: "entry-draw-2",
      bookId: BOOK_2_ID,
      passNumber: 1,
      authorPlayerId: ARTIST_2,
      type: "drawing" as const,
      content: "",
      fuzzyCorrect: null,
      ownerOverride: null,
    };

    const FOUR_SCORE_ROWS = [
      { id: "s1", playerId: GUESSER_PLAYER_ID, reason: "correct_guess" },
      { id: "s2", playerId: ARTIST_PLAYER_ID, reason: "drawing_credited" },
      { id: "s3", playerId: GUESSER_2, reason: "correct_guess" },
      { id: "s4", playerId: ARTIST_2, reason: "drawing_credited" },
    ];
    const { mock: insertMock } = makeInsertMock(FOUR_SCORE_ROWS);

    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],
        guessEntries,     // both correct guess entries
        [DRAWING_ENTRY],  // drawing for book 1
        [DRAWING_2],      // drawing for book 2
      ]),
      insert: insertMock,
    };

    const service = createCompetitiveScoreService(db as never);
    const result = await service.tallyCompetitiveScores(ROOM_ID);

    expect(result).toHaveLength(4);
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("skips drawing_credited when the preceding drawing entry is not found", async () => {
    const SCORE_ROWS = [
      { id: "score-1", playerId: GUESSER_PLAYER_ID, reason: "correct_guess" },
    ];
    const { mock: insertMock, valuesCalls } = makeInsertMock(SCORE_ROWS);

    const db = {
      select: makeSelectSequence([
        [ROOM_ROW],
        [GUESS_ENTRY],
        [],  // drawing not found
      ]),
      insert: insertMock,
    };

    const service = createCompetitiveScoreService(db as never);
    const result = await service.tallyCompetitiveScores(ROOM_ID);

    expect(result).toHaveLength(1);
    const inserted = valuesCalls[0] as Array<{ reason: string }>;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ reason: "correct_guess" });
  });
});

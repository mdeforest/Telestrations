import { describe, it, expect, vi } from "vitest";
import {
  createVoteService,
  SelfVoteError,
  EntryNotInBookError,
} from "../vote-service";

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a select mock that returns responses in sequence.
 * Handles:
 *  - select().from().where()
 *  - select().from().innerJoin()...N times...where().groupBy().orderBy()
 */
function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;

  // Returns a terminal node that resolves the next response.
  // Supports .where() → thenable with .groupBy().orderBy() chaining.
  function makeTerminal() {
    const resp = responses[callIdx++] ?? [];
    const terminal = {
      then: (res: (v: unknown) => unknown, rej?: (r: unknown) => unknown) =>
        Promise.resolve(resp).then(res as never, rej as never),
      catch: (rej: (r: unknown) => unknown) =>
        Promise.resolve(resp).catch(rej as never),
      groupBy: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue(Promise.resolve(resp)),
      }),
      orderBy: vi.fn().mockReturnValue(Promise.resolve(resp)),
    };
    return terminal;
  }

  // Builds a chainable innerJoin node that can chain further innerJoins
  // and eventually resolves via where() → terminal.
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

/** Insert mock — records values and resolves with returned rows. */
function makeInsertMock(returning: unknown[] = []) {
  const valuesCalls: unknown[] = [];
  const mock = vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((v: unknown) => {
      valuesCalls.push(v);
      return {
        returning: vi.fn().mockResolvedValue(returning),
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(returning),
        }),
      };
    }),
  });
  return { mock, valuesCalls };
}

// ── Test data ─────────────────────────────────────────────────────────────────

const BOOK_ID = "book-1";
const ENTRY_ID = "entry-1";
const VOTE_ID = "vote-1";
const ROOM_ID = "room-1";
const ROUND_ID = "round-1";
const VOTER_ID = "player-voter";
const AUTHOR_ID = "player-author";

const ENTRY_ROW = {
  id: ENTRY_ID,
  bookId: BOOK_ID,
  passNumber: 1,
  authorPlayerId: AUTHOR_ID,
  type: "drawing" as const,
  content: "",
};

const VOTE_ROW = {
  id: VOTE_ID,
  bookId: BOOK_ID,
  voterPlayerId: VOTER_ID,
  entryId: ENTRY_ID,
  voteType: "favorite_sketch" as const,
};

// ── castVote ──────────────────────────────────────────────────────────────────

describe("castVote", () => {
  it("inserts a vote and returns the new vote record", async () => {
    const { mock: insertMock } = makeInsertMock([VOTE_ROW]);

    const db = {
      select: makeSelectSequence([[ENTRY_ROW]]), // entry lookup
      insert: insertMock,
    };

    const service = createVoteService(db);
    const result = await service.castVote(BOOK_ID, VOTER_ID, ENTRY_ID, "favorite_sketch");

    expect(result).toMatchObject({ id: VOTE_ID, voteType: "favorite_sketch" });
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("throws SelfVoteError when the voter is the entry author", async () => {
    const db = {
      select: makeSelectSequence([[{ ...ENTRY_ROW, authorPlayerId: VOTER_ID }]]),
      insert: vi.fn(),
    };

    const service = createVoteService(db);
    await expect(
      service.castVote(BOOK_ID, VOTER_ID, ENTRY_ID, "favorite_sketch")
    ).rejects.toThrow(SelfVoteError);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throws EntryNotInBookError when the entry is not in the book", async () => {
    const db = {
      select: makeSelectSequence([[]]), // empty → entry not found in book
      insert: vi.fn(),
    };

    const service = createVoteService(db);
    await expect(
      service.castVote(BOOK_ID, VOTER_ID, ENTRY_ID, "favorite_sketch")
    ).rejects.toThrow(EntryNotInBookError);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ── tallyVotes ────────────────────────────────────────────────────────────────

describe("tallyVotes", () => {
  /**
   * Minimal tally scenario:
   *  - 1 book in the room, 1 entry, 2 votes for that entry (sketch)
   *  - tallyVotes writes 2 score rows: 1 per vote
   */
  it("writes one score row per vote received and returns them", async () => {
    const SCORE_ROW = {
      id: "score-1",
      roomId: ROOM_ID,
      roundId: ROUND_ID,
      playerId: AUTHOR_ID,
      points: 1,
      reason: "favorite_sketch" as const,
    };

    // Sequence: votes with joined entry.authorPlayerId + book.roundId
    const voteAggRow = {
      entryId: ENTRY_ID,
      authorPlayerId: AUTHOR_ID,
      roundId: ROUND_ID,
      voteType: "favorite_sketch" as const,
      voteCount: 2,
    };

    const { mock: insertMock } = makeInsertMock([SCORE_ROW, SCORE_ROW]);

    // DB select responses: aggregated vote rows
    const db = {
      select: makeSelectSequence([[voteAggRow]]),
      insert: insertMock,
    };

    const service = createVoteService(db);
    const scores = await service.tallyVotes(ROOM_ID);

    // Should insert into scores table
    expect(insertMock).toHaveBeenCalledOnce();
    // Should return the inserted rows
    expect(scores).toHaveLength(2);
  });

  it("returns an empty array when there are no votes", async () => {
    const db = {
      select: makeSelectSequence([[]]), // no votes
      insert: vi.fn(),
    };

    const service = createVoteService(db);
    const scores = await service.tallyVotes(ROOM_ID);

    expect(scores).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

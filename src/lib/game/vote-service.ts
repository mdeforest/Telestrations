import { books, entries, rounds, scores, votes } from "@/lib/db/schema";
import { and, count, eq } from "drizzle-orm";

// ── Errors ─────────────────────────────────────────────────────────────────────

export class SelfVoteError extends Error {
  constructor() {
    super("Players cannot vote for their own entries");
    this.name = "SelfVoteError";
  }
}

export class EntryNotInBookError extends Error {
  constructor() {
    super("Entry does not belong to the specified book");
    this.name = "EntryNotInBookError";
  }
}

// ── Service factory ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createVoteService(db: any) {
  /**
   * Record a vote for an entry in a book.
   * Throws SelfVoteError if the voter is the entry's author.
   * Throws EntryNotInBookError if the entry doesn't belong to the book.
   * The unique constraint (bookId, voterPlayerId, voteType) is enforced at the DB level.
   */
  async function castVote(
    bookId: string,
    voterPlayerId: string,
    entryId: string,
    voteType: "favorite_sketch" | "favorite_guess"
  ) {
    // Verify entry exists in the book
    const [entry] = await db
      .select()
      .from(entries)
      .where(and(eq(entries.id, entryId), eq(entries.bookId, bookId)));

    if (!entry) throw new EntryNotInBookError();
    if (entry.authorPlayerId === voterPlayerId) throw new SelfVoteError();

    const [vote] = await db
      .insert(votes)
      .values({ bookId, voterPlayerId, entryId, voteType })
      .returning();

    return vote;
  }

  /**
   * Tally all votes for a room and write score rows (1 point per vote received).
   * Returns all inserted score rows.
   */
  async function tallyVotes(roomId: string) {
    // Get aggregated vote counts: (authorPlayerId, roundId, voteType, voteCount)
    const voteCounts = await db
      .select({
        entryId: entries.id,
        authorPlayerId: entries.authorPlayerId,
        roundId: books.roundId,
        voteType: votes.voteType,
        voteCount: count(votes.id),
      })
      .from(votes)
      .innerJoin(entries, eq(votes.entryId, entries.id))
      .innerJoin(books, eq(votes.bookId, books.id))
      .innerJoin(rounds, eq(books.roundId, rounds.id))
      .where(eq(rounds.roomId, roomId))
      .groupBy(entries.id, entries.authorPlayerId, books.roundId, votes.voteType)
      .orderBy(entries.id);

    if (voteCounts.length === 0) return [];

    // Build one score row per vote received (each worth 1 point)
    const scoreRows: {
      roomId: string;
      roundId: string;
      playerId: string;
      points: number;
      reason: "favorite_sketch" | "favorite_guess";
    }[] = [];

    for (const row of voteCounts) {
      for (let i = 0; i < row.voteCount; i++) {
        scoreRows.push({
          roomId,
          roundId: row.roundId,
          playerId: row.authorPlayerId,
          points: 1,
          reason: row.voteType as "favorite_sketch" | "favorite_guess",
        });
      }
    }

    const inserted = await db.insert(scores).values(scoreRows).returning();
    return inserted;
  }

  return { castVote, tallyVotes };
}

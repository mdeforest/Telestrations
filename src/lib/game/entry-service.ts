import { books, entries, rounds } from "@/lib/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

// ── Errors ───────────────────────────────────────────────────────────────────

export class EntryNotFoundError extends Error {
  constructor(bookId: string, passNumber: number) {
    super(`Entry not found: book ${bookId} pass ${passNumber}`);
    this.name = "EntryNotFoundError";
  }
}

export class WrongAuthorError extends Error {
  constructor(playerId: string, authorPlayerId: string) {
    super(`Player ${playerId} is not the author (expected ${authorPlayerId})`);
    this.name = "WrongAuthorError";
  }
}

export class AlreadySubmittedError extends Error {
  constructor(entryId: string) {
    super(`Entry ${entryId} has already been submitted`);
    this.name = "AlreadySubmittedError";
  }
}

export class ContentTooLargeError extends Error {
  constructor(size: number) {
    super(`Content size ${size} exceeds 500KB limit`);
    this.name = "ContentTooLargeError";
  }
}

// Max drawing JSON size: 500KB
const MAX_CONTENT_BYTES = 500_000;

// ── Service factory ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEntryService(db: any) {
  /**
   * Submit a drawing or guess entry for a specific book + pass.
   * Validates the submitting player is the designated author, enforces size
   * limits, and prevents double submission. When all entries for the current
   * pass are submitted, advances `currentPass` and resets `timerStartedAt`.
   */
  async function submitEntry(
    bookId: string,
    passNumber: number,
    playerId: string,
    content: string
  ): Promise<{ allSubmitted: boolean }> {
    // 1. Find the entry
    const [entry] = await db
      .select()
      .from(entries)
      .where(and(eq(entries.bookId, bookId), eq(entries.passNumber, passNumber)));

    if (!entry) {
      throw new EntryNotFoundError(bookId, passNumber);
    }

    // 2. Validate author
    if (entry.authorPlayerId !== playerId) {
      throw new WrongAuthorError(playerId, entry.authorPlayerId);
    }

    // 3. Guard double submission
    if (entry.submittedAt !== null) {
      throw new AlreadySubmittedError(entry.id);
    }

    // 4. Validate content size
    if (content.length > MAX_CONTENT_BYTES) {
      throw new ContentTooLargeError(content.length);
    }

    // 5. Save content + submitted_at
    await db
      .update(entries)
      .set({ content, submittedAt: new Date() })
      .where(eq(entries.id, entry.id))
      .returning();

    // 6. Count remaining unsubmitted entries for this pass across all books in
    //    the same round. Look up the book to get roundId, then count.
    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, bookId));

    if (!book) {
      return { allSubmitted: false };
    }

    // Count unsubmitted entries for this pass, scoped to the round via join
    const [pending] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(entries)
      .innerJoin(books, eq(entries.bookId, books.id))
      .where(
        and(
          eq(books.roundId, book.roundId),
          eq(entries.passNumber, passNumber),
          isNull(entries.submittedAt)
        )
      );

    const count = pending?.count ?? 1;

    if (count === 0) {
      // All submitted — advance pass
      const [round] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, book.roundId));

      if (round) {
        await db
          .update(rounds)
          .set({ currentPass: round.currentPass + 1, timerStartedAt: new Date() })
          .where(eq(rounds.id, round.id))
          .returning();
      }

      return { allSubmitted: true };
    }

    return { allSubmitted: false };
  }

  /**
   * Called when the 60-second timer expires. Blanks all unsubmitted entries for
   * the round's current pass, then advances the pass.
   */
  async function expirePass(roundId: string): Promise<void> {
    const [round] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId));

    if (!round) return;

    // 1. Load all book IDs in this round to scope the entry update
    const roundBooks = await db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.roundId, roundId));

    const bookIds = roundBooks.map((b: { id: string }) => b.id);

    // 2. Blank unsubmitted entries — only within this round's books
    //    Guard against inArray([]) which is invalid SQL in some drivers
    if (bookIds.length > 0) {
      await db
        .update(entries)
        .set({ isBlank: true, submittedAt: new Date() })
        .where(
          and(
            inArray(entries.bookId, bookIds),
            eq(entries.passNumber, round.currentPass),
            isNull(entries.submittedAt)
          )
        )
        .returning();
    }

    // 3. Advance the pass
    await db
      .update(rounds)
      .set({ currentPass: round.currentPass + 1, timerStartedAt: new Date() })
      .where(eq(rounds.id, roundId))
      .returning();
  }

  return { submitEntry, expirePass };
}

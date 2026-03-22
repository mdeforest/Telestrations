import { books, entries, rooms, rounds, scores } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

// ── Errors ────────────────────────────────────────────────────────────────────

export class NoRoomFoundError extends Error {
  constructor(roomId: string) {
    super(`Room not found: ${roomId}`);
    this.name = "NoRoomFoundError";
  }
}

// ── Service factory ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCompetitiveScoreService(db: any) {
  /**
   * Tally competitive scores after the reveal phase.
   *
   * For each guess entry whose effective result is "correct":
   *  - effective correct = ownerOverride if set, else fuzzyCorrect
   *
   * Writes:
   *  - 1 `correct_guess` score row for the guesser
   *  - 1 `drawing_credited` score row for the author of the preceding drawing
   *    (passNumber - 1 in the same book), if that drawing entry exists
   *
   * Returns all inserted score rows.
   */
  async function tallyCompetitiveScores(roomId: string) {
    // 1. Load room
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId));

    if (!room) throw new NoRoomFoundError(roomId);

    // 2. Fetch all guess entries across all books in this room,
    //    joined through books → rounds → rooms filter
    const guessEntries = await db
      .select({
        id: entries.id,
        bookId: entries.bookId,
        passNumber: entries.passNumber,
        authorPlayerId: entries.authorPlayerId,
        fuzzyCorrect: entries.fuzzyCorrect,
        ownerOverride: entries.ownerOverride,
        roundId: books.roundId,
      })
      .from(entries)
      .innerJoin(books, eq(entries.bookId, books.id))
      .innerJoin(rounds, eq(books.roundId, rounds.id))
      .where(
        and(
          eq(rounds.roomId, roomId),
          eq(entries.type, "guess")
        )
      );

    // Determine which guesses are effectively correct
    const correctGuesses = guessEntries.filter(
      (e: { fuzzyCorrect: boolean | null; ownerOverride: boolean | null }) => {
        if (e.ownerOverride !== null) return e.ownerOverride;
        return e.fuzzyCorrect === true;
      }
    );

    if (correctGuesses.length === 0) return [];

    // 3. For each correct guess, find the preceding drawing entry
    //    (same book, passNumber - 1)
    const scoreRows: {
      roomId: string;
      roundId: string;
      playerId: string;
      points: number;
      reason: "correct_guess" | "drawing_credited";
    }[] = [];

    for (const guess of correctGuesses) {
      // Add correct_guess score for the guesser
      scoreRows.push({
        roomId,
        roundId: guess.roundId,
        playerId: guess.authorPlayerId,
        points: 1,
        reason: "correct_guess",
      });

      // Find the drawing that preceded this guess
      const [drawingEntry] = await db
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.bookId, guess.bookId),
            eq(entries.passNumber, guess.passNumber - 1)
          )
        );

      if (drawingEntry) {
        scoreRows.push({
          roomId,
          roundId: guess.roundId,
          playerId: drawingEntry.authorPlayerId,
          points: 1,
          reason: "drawing_credited",
        });
      }
    }

    const inserted = await db.insert(scores).values(scoreRows).returning();
    return inserted;
  }

  return { tallyCompetitiveScores };
}

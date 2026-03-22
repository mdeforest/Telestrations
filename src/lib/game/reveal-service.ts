import { books, entries, players, rooms, rounds } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";

// ── Errors ────────────────────────────────────────────────────────────────────

export class RoomNotFoundError extends Error {
  constructor(code: string) {
    super(`Room not found: ${code}`);
    this.name = "RoomNotFoundError";
  }
}

export class NotHostError extends Error {
  constructor() {
    super("Only the host can advance the reveal");
    this.name = "NotHostError";
  }
}

export class NotRevealPhaseError extends Error {
  constructor() {
    super("Room is not in reveal phase");
    this.name = "NotRevealPhaseError";
  }
}

// ── Service factory ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRevealService(db: any) {
  /**
   * Advance the reveal by one step within the CURRENT ROUND's books.
   *
   * Progression within a round:
   *   - More entries in current book → increment revealEntryIndex
   *   - At end of current book, more books remain → increment revealBookIndex, reset entry index
   *   - At end of last book in this round:
   *       - More rounds remain → transition to prompts for the next round
   *       - Final round → mark room as "finished"
   *
   * Only the host player may advance.
   *
   * Returns:
   *   { revealBookIndex, revealEntryIndex, finished, nextRound, nextRoundId }
   */
  async function advanceReveal(
    code: string,
    playerId: string
  ): Promise<{
    revealBookIndex: number;
    revealEntryIndex: number;
    finished: boolean;
    nextRound: boolean;
    nextRoundId: string | null;
  }> {
    // 1. Fetch room
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.code, code));

    if (!room) throw new RoomNotFoundError(code);
    if (room.hostPlayerId !== playerId) throw new NotHostError();
    if (room.status !== "reveal") throw new NotRevealPhaseError();

    // 2. Determine which round we are currently revealing
    //    currentRound=0 means round 1 (the very first round)
    const currentRoundNumber = Math.max(room.currentRound, 1);

    // 3. Get books in the CURRENT ROUND only, ordered by seat order
    const roundBooks = await db
      .select({ id: books.id, roundNumber: rounds.roundNumber, seatOrder: players.seatOrder })
      .from(books)
      .innerJoin(rounds, eq(books.roundId, rounds.id))
      .innerJoin(players, eq(books.ownerPlayerId, players.id))
      .where(
        and(
          eq(rounds.roomId, room.id),
          eq(rounds.roundNumber, currentRoundNumber)
        )
      )
      .orderBy(asc(players.seatOrder));

    // 4. Guard against stale/out-of-bounds index (e.g., crash recovery)
    const currentBook = roundBooks[room.revealBookIndex];
    if (!currentBook) {
      await db
        .update(rooms)
        .set({ status: "finished" })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: room.revealBookIndex,
        revealEntryIndex: room.revealEntryIndex,
        finished: true,
        nextRound: false,
        nextRoundId: null,
      };
    }

    // 5. Get entries for the current book ordered by pass number
    const bookEntries = await db
      .select()
      .from(entries)
      .where(eq(entries.bookId, currentBook.id))
      .orderBy(asc(entries.passNumber));

    const totalEntries = bookEntries.length;
    const totalBooks = roundBooks.length;

    // 6. Determine and apply new state
    if (room.revealEntryIndex + 1 < totalEntries) {
      // More entries in current book
      const newEntryIndex = room.revealEntryIndex + 1;
      await db
        .update(rooms)
        .set({ revealEntryIndex: newEntryIndex })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: room.revealBookIndex,
        revealEntryIndex: newEntryIndex,
        finished: false,
        nextRound: false,
        nextRoundId: null,
      };
    } else if (room.revealBookIndex + 1 < totalBooks) {
      // Move to next book within this round
      const newBookIndex = room.revealBookIndex + 1;
      await db
        .update(rooms)
        .set({ revealBookIndex: newBookIndex, revealEntryIndex: 0 })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: newBookIndex,
        revealEntryIndex: 0,
        finished: false,
        nextRound: false,
        nextRoundId: null,
      };
    } else if (currentRoundNumber < room.numRounds) {
      // End of this round's books — more rounds remain → advance to next round's prompts
      const nextRoundNumber = currentRoundNumber + 1;

      const [nextRoundRow] = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(
          and(
            eq(rounds.roomId, room.id),
            eq(rounds.roundNumber, nextRoundNumber)
          )
        );

      await db
        .update(rooms)
        .set({
          status: "prompts",
          currentRound: nextRoundNumber,
          revealBookIndex: 0,
          revealEntryIndex: 0,
        })
        .where(eq(rooms.id, room.id));

      return {
        revealBookIndex: room.revealBookIndex,
        revealEntryIndex: room.revealEntryIndex,
        finished: false,
        nextRound: true,
        nextRoundId: nextRoundRow?.id ?? null,
      };
    } else {
      // End of last round's books — game finished
      await db
        .update(rooms)
        .set({ status: "finished" })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: room.revealBookIndex,
        revealEntryIndex: room.revealEntryIndex,
        finished: true,
        nextRound: false,
        nextRoundId: null,
      };
    }
  }

  return { advanceReveal };
}

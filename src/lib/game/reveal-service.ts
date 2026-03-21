import { books, entries, players, rooms, rounds } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";

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

// ── Service factory ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRevealService(db: any) {
  /**
   * Advance the reveal by one step:
   * - If more entries remain in the current book → increment revealEntryIndex
   * - If at end of current book but more books remain → increment revealBookIndex, reset entry index
   * - If at end of last book → mark room status as "finished"
   *
   * Only the host player may advance.
   */
  async function advanceReveal(
    code: string,
    playerId: string
  ): Promise<{ revealBookIndex: number; revealEntryIndex: number; finished: boolean }> {
    // 1. Fetch room
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.code, code));

    if (!room) throw new RoomNotFoundError(code);
    if (room.hostPlayerId !== playerId) throw new NotHostError();

    // 2. Get all books in the room ordered by round number then player seat order
    const allBooks = await db
      .select({ id: books.id, roundNumber: rounds.roundNumber, seatOrder: players.seatOrder })
      .from(books)
      .innerJoin(rounds, eq(books.roundId, rounds.id))
      .innerJoin(players, eq(books.ownerPlayerId, players.id))
      .where(eq(rounds.roomId, room.id))
      .orderBy(asc(rounds.roundNumber), asc(players.seatOrder));

    // 3. Guard against stale/out-of-bounds index (e.g., crash recovery)
    const currentBook = allBooks[room.revealBookIndex];
    if (!currentBook) {
      await db
        .update(rooms)
        .set({ status: "finished" })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: room.revealBookIndex,
        revealEntryIndex: room.revealEntryIndex,
        finished: true,
      };
    }

    // 4. Get entries for the current book ordered by pass number
    const bookEntries = await db
      .select()
      .from(entries)
      .where(eq(entries.bookId, currentBook.id))
      .orderBy(asc(entries.passNumber));

    const totalEntries = bookEntries.length;
    const totalBooks = allBooks.length;

    // 5. Determine and apply new state
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
      };
    } else if (room.revealBookIndex + 1 < totalBooks) {
      // Move to next book
      const newBookIndex = room.revealBookIndex + 1;
      await db
        .update(rooms)
        .set({ revealBookIndex: newBookIndex, revealEntryIndex: 0 })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: newBookIndex,
        revealEntryIndex: 0,
        finished: false,
      };
    } else {
      // End of all books — game finished
      await db
        .update(rooms)
        .set({ status: "finished" })
        .where(eq(rooms.id, room.id));
      return {
        revealBookIndex: room.revealBookIndex,
        revealEntryIndex: room.revealEntryIndex,
        finished: true,
      };
    }
  }

  return { advanceReveal };
}

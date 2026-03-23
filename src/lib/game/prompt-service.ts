import { books, rounds, rooms, prompts, players } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

// ── Errors ──────────────────────────────────────────────────────────────────

export class PromptNotFoundError extends Error {
  constructor(promptId: string) {
    super(`Prompt not found: ${promptId}`);
    this.name = "PromptNotFoundError";
  }
}

export class AlreadySelectedError extends Error {
  constructor(playerId: string) {
    super(`Player ${playerId} has already selected a prompt`);
    this.name = "AlreadySelectedError";
  }
}

export class BookNotFoundError extends Error {
  constructor(roundId: string, playerId: string) {
    super(`No book found for player ${playerId} in round ${roundId}`);
    this.name = "BookNotFoundError";
  }
}

// ── Seeded shuffle ───────────────────────────────────────────────────────────

/**
 * Full Fisher-Yates shuffle using a mulberry32 PRNG seeded from `roundId`.
 * Every player in the same round sees the same ordering, so non-overlapping
 * slices (by seatOrder) are guaranteed to be unique.
 */
function seededShuffle<T>(arr: T[], roundId: string): T[] {
  // Hash the UUID string into a 32-bit seed
  let seed = 0x12345678;
  for (let i = 0; i < roundId.length; i++) {
    seed = Math.imul(seed ^ roundId.charCodeAt(i), 0x9e3779b9);
    seed = ((seed << 13) | (seed >>> 19)) >>> 0;
  }
  // mulberry32 PRNG
  function next(): number {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Service factory ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPromptService(db: any) {
  /**
   * Record a player's prompt selection for their book in the given round.
   * When all players have selected, transitions the room to "active".
   */
  async function selectPrompt(
    roundId: string,
    playerId: string,
    promptId: string
  ): Promise<{ allSelected: boolean }> {
    // 1. Find the player's book in this round
    const [book] = await db
      .select()
      .from(books)
      .where(
        and(eq(books.roundId, roundId), eq(books.ownerPlayerId, playerId))
      );

    if (!book) {
      throw new BookNotFoundError(roundId, playerId);
    }

    // 2. Guard against double-selection
    if (book.originalPrompt !== "") {
      throw new AlreadySelectedError(playerId);
    }

    // 3. Verify the chosen prompt exists
    const [prompt] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId));

    if (!prompt) {
      throw new PromptNotFoundError(promptId);
    }

    // 4. Record the selection
    await db
      .update(books)
      .set({ originalPrompt: prompt.text })
      .where(eq(books.id, book.id))
      .returning();

    // 5. Check how many books in this round still have no prompt chosen
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(books)
      .where(and(eq(books.roundId, roundId), eq(books.originalPrompt, "")));

    // 6. If everyone has selected, transition the room to active and start the timer
    if (count === 0) {
      const [round] = await db
        .select()
        .from(rounds)
        .where(eq(rounds.id, roundId));

      await db
        .update(rooms)
        .set({ status: "active", currentRound: round.roundNumber })
        .where(eq(rooms.id, round.roomId))
        .returning();

      // Record when pass 1 begins so clients can derive the countdown
      await db
        .update(rounds)
        .set({ timerStartedAt: new Date() })
        .where(eq(rounds.id, roundId))
        .returning();
    }

    return { allSelected: count === 0 };
  }

  /**
   * Return 3 prompts for a player to choose from, guaranteed unique across
   * all players in the round. Uses a round-seeded shuffle so every player
   * in the same round sees the same ordering, then slices by seatOrder so
   * each seat gets a non-overlapping window.
   *
   * Also returns `alreadySelected` so the UI can skip straight to the
   * waiting screen if the player refreshes after having already chosen.
   */
  async function getPromptOptions(
    roundId: string,
    playerId: string
  ): Promise<{ options: Array<{ id: string; text: string }>; alreadySelected: boolean }> {
    // Check whether this player has already selected a prompt
    const [book] = await db
      .select()
      .from(books)
      .where(and(eq(books.roundId, roundId), eq(books.ownerPlayerId, playerId)));

    const alreadySelected = !!book && book.originalPrompt !== "";

    // Look up the player's seat order so we can pick their unique slice
    const [player] = await db
      .select({ seatOrder: players.seatOrder })
      .from(players)
      .where(eq(players.id, playerId));

    const seatOrder = player?.seatOrder ?? 0;

    // Fetch all prompts and shuffle them deterministically for this round
    const all = await db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts);

    const shuffled = seededShuffle(all, roundId);
    const offset = seatOrder * 3;
    const options = shuffled.slice(offset, offset + 3);

    return { options, alreadySelected };
  }

  return { selectPrompt, getPromptOptions };
}

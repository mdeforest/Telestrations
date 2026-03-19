import { books, rounds, rooms, prompts } from "@/lib/db/schema";
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
   * Return 3 randomly sampled prompts for a player to choose from,
   * plus an `alreadySelected` flag so the UI can skip straight to the
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

    // Fetch the full prompt pool and sample 3 via partial Fisher-Yates
    const all = await db
      .select({ id: prompts.id, text: prompts.text })
      .from(prompts);

    const pool = [...all];
    const count = Math.min(3, pool.length);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return { options: pool.slice(0, count), alreadySelected };
  }

  return { selectPrompt, getPromptOptions };
}

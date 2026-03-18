import { rooms, players, rounds, books, entries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { chainRouter, chainLength, entryType } from "@/lib/game/chain-router";

// ── Error types ─────────────────────────────────────────────────────────────

export class RoomNotFoundError extends Error {
  constructor(code: string) {
    super(`Room not found: ${code}`);
    this.name = "RoomNotFoundError";
  }
}

export class DuplicateNicknameError extends Error {
  constructor(nickname: string) {
    super(`Nickname already taken: ${nickname}`);
    this.name = "DuplicateNicknameError";
  }
}

export class NotHostError extends Error {
  constructor() {
    super("Only the host can start the game");
    this.name = "NotHostError";
  }
}

export class InsufficientPlayersError extends Error {
  constructor(count: number) {
    super(`Need at least 4 players to start; currently ${count}`);
    this.name = "InsufficientPlayersError";
  }
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}

// ── Code generation ──────────────────────────────────────────────────────────

// Unambiguous uppercase alpha chars (no 0/O/1/I/l)
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";

function generateRoomCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join("");
}

// ── Service factory ──────────────────────────────────────────────────────────

// Accepts any drizzle-compatible db instance so tests can inject a mock.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRoomService(db: any) {
  async function createRoom(
    nickname: string
  ): Promise<{ id: string; code: string; hostPlayerId: string }> {
    const code = generateRoomCode();

    const [room] = await db
      .insert(rooms)
      .values({ code })
      .returning();

    // Create the host player (seat 1)
    const [player] = await db
      .insert(players)
      .values({ roomId: room.id, nickname, seatOrder: 1 })
      .returning();

    // Assign host
    await db
      .update(rooms)
      .set({ hostPlayerId: player.id })
      .where(eq(rooms.id, room.id));

    return { id: room.id, code: room.code, hostPlayerId: player.id };
  }

  async function joinRoom(
    code: string,
    nickname: string
  ): Promise<{ playerId: string; seatOrder: number }> {
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.code, code));

    if (!room) {
      throw new RoomNotFoundError(code);
    }

    const existingPlayers = await db
      .select()
      .from(players)
      .where(eq(players.roomId, room.id));

    const duplicate = existingPlayers.some(
      (p: { nickname: string }) => p.nickname === nickname
    );
    if (duplicate) {
      throw new DuplicateNicknameError(nickname);
    }

    const seatOrder = existingPlayers.length + 1;

    const [player] = await db
      .insert(players)
      .values({ roomId: room.id, nickname, seatOrder })
      .returning();

    return { playerId: player.id, seatOrder: player.seatOrder };
  }

  async function startGame(
    code: string,
    hostPlayerId: string,
    config: { numRounds: number; scoringMode: "friendly" | "competitive" }
  ): Promise<{ id: string; code: string; status: string }> {
    if (config.numRounds < 3 || config.numRounds > 8) {
      throw new InvalidConfigError("numRounds must be between 3 and 8");
    }

    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.code, code));

    if (!room) {
      throw new RoomNotFoundError(code);
    }

    if (room.hostPlayerId !== hostPlayerId) {
      throw new NotHostError();
    }

    const roomPlayers = await db
      .select()
      .from(players)
      .where(eq(players.roomId, room.id));

    if (roomPlayers.length < 4) {
      throw new InsufficientPlayersError(roomPlayers.length);
    }

    const [updated] = await db
      .update(rooms)
      .set({ status: "prompts", numRounds: config.numRounds, scoringMode: config.scoringMode })
      .where(eq(rooms.id, room.id))
      .returning();

    // Create all rounds, books, and entries upfront with deterministic routing.
    const N = roomPlayers.length;
    const len = chainLength(N);

    // Sort players by seatOrder so index === ownerSeat (0-based)
    const sortedPlayers = [...roomPlayers].sort(
      (a: { seatOrder: number }, b: { seatOrder: number }) => a.seatOrder - b.seatOrder
    );

    // 1. Bulk-insert all rounds
    const roundRows = Array.from({ length: config.numRounds }, (_, i) => ({
      roomId: room.id,
      roundNumber: i + 1,
    }));
    const createdRounds = await db.insert(rounds).values(roundRows).returning();

    for (const round of createdRounds) {
      // 2. Bulk-insert all books for this round (one per player, prompt filled in later)
      const bookRows = sortedPlayers.map((p: { id: string }) => ({
        roundId: round.id,
        ownerPlayerId: p.id,
        originalPrompt: "",
      }));
      const createdBooks = await db.insert(books).values(bookRows).returning();

      // 3. Bulk-insert all entries for this round's books
      const entryRows: {
        bookId: string;
        passNumber: number;
        authorPlayerId: string;
        type: "drawing" | "guess";
      }[] = [];

      for (const book of createdBooks) {
        const ownerSeat = sortedPlayers.findIndex(
          (p: { id: string }) => p.id === book.ownerPlayerId
        );
        for (let pass = 1; pass <= len; pass++) {
          const authorSeat = chainRouter(ownerSeat, pass, N);
          entryRows.push({
            bookId: book.id,
            passNumber: pass,
            authorPlayerId: sortedPlayers[authorSeat].id,
            type: entryType(pass),
          });
        }
      }

      await db.insert(entries).values(entryRows).returning();
    }

    return { id: updated.id, code: updated.code, status: updated.status };
  }

  return { createRoom, joinRoom, startGame };
}

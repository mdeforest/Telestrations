import { rooms, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

  return { createRoom, joinRoom };
}

import { players, rooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// ── Errors ───────────────────────────────────────────────────────────────────

export class PlayerNotFoundError extends Error {
  constructor(playerId: string) {
    super(`Player not found: ${playerId}`);
    this.name = "PlayerNotFoundError";
  }
}

// ── Service factory ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPlayerConnectionService(db: any) {
  /**
   * Mark a player as connected or disconnected.
   * Returns the room code and nickname so the caller can publish an Ably event.
   */
  async function updateConnection(
    playerId: string,
    isConnected: boolean
  ): Promise<{ roomCode: string; nickname: string }> {
    const [player] = await db.select().from(players).where(eq(players.id, playerId));

    if (!player) {
      throw new PlayerNotFoundError(playerId);
    }

    await db
      .update(players)
      .set({ isConnected })
      .where(eq(players.id, playerId))
      .returning();

    const [room] = await db.select().from(rooms).where(eq(rooms.id, player.roomId));

    return { roomCode: room?.code ?? "", nickname: player.nickname };
  }

  return { updateConnection };
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createPlayerConnectionService,
  PlayerNotFoundError,
} from "@/lib/game/player-connection-service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

/**
 * PATCH /api/players/[id]/connection
 *
 * Body: { isConnected: boolean }
 *
 * Updates a player's connection status and publishes a `player-connection-changed`
 * event so the host screen can refresh the disconnected list.
 *
 * Called by clients when they detect a peer leaving via Ably presence.
 * No auth cookie required — presence events are server-verified via Ably.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: playerId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).isConnected !== "boolean"
  ) {
    return NextResponse.json(
      { error: "isConnected (boolean) is required" },
      { status: 400 }
    );
  }

  const { isConnected } = body as { isConnected: boolean };

  const service = createPlayerConnectionService(db);

  try {
    const { roomCode, nickname } = await service.updateConnection(playerId, isConnected);

    if (roomCode) {
      await getAblyRest()
        .channels.get(channels.roomPlayers(roomCode))
        .publish("player-connection-changed", { playerId, nickname, isConnected });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PlayerNotFoundError) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    throw err;
  }
}

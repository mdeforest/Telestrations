import { NextRequest, NextResponse } from "next/server";
import { getPlayerId } from "@/lib/debug/get-player-id";
import { db } from "@/lib/db";
import {
  createRevealService,
  RoomNotFoundError,
  NotHostError,
  NotRevealPhaseError,
} from "@/lib/game/reveal-service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const playerId = await getPlayerId();

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createRevealService(db);

  try {
    const result = await service.advanceReveal(code.toUpperCase(), playerId);

    await getAblyRest()
      .channels.get(channels.revealAdvance(code.toUpperCase()))
      .publish("reveal:advance", result);

    // When the round's reveal is complete and there's another round, broadcast
    // the prompts transition so all clients advance to the next round's prompt phase
    if (result.nextRound) {
      await getAblyRest()
        .channels.get(channels.roomStatus(code.toUpperCase()))
        .publish("room-status-changed", {
          status: "prompts",
          roundId: result.nextRoundId,
        });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RoomNotFoundError) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (err instanceof NotHostError) {
      return NextResponse.json({ error: "Only the host can advance the reveal" }, { status: 403 });
    }
    if (err instanceof NotRevealPhaseError) {
      return NextResponse.json({ error: "Room is not in reveal phase" }, { status: 409 });
    }
    throw err;
  }
}

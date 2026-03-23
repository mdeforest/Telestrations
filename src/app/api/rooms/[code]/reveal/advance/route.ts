import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createRevealService,
  RoomNotFoundError,
  NotRevealPhaseError,
} from "@/lib/game/reveal-service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Look up the host player ID from the room directly — the host TV view
  // has no player session cookie, so we bypass cookie-based auth and use
  // the room's recorded hostPlayerId instead.
  const [room] = await db
    .select({ hostPlayerId: rooms.hostPlayerId })
    .from(rooms)
    .where(eq(rooms.code, code.toUpperCase()));

  if (!room?.hostPlayerId) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const service = createRevealService(db);

  try {
    const result = await service.advanceReveal(code.toUpperCase(), room.hostPlayerId);

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
    if (err instanceof NotRevealPhaseError) {
      return NextResponse.json({ error: "Room is not in reveal phase" }, { status: 409 });
    }
    throw err;
  }
}

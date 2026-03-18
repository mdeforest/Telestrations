import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  createRoomService,
  RoomNotFoundError,
  NotHostError,
  InsufficientPlayersError,
  InvalidConfigError,
} from "@/lib/rooms/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));

  const numRounds = typeof body.numRounds === "number" ? body.numRounds : undefined;
  const scoringMode = body.scoringMode === "friendly" || body.scoringMode === "competitive"
    ? body.scoringMode
    : undefined;

  if (numRounds === undefined || scoringMode === undefined) {
    return NextResponse.json(
      { error: "numRounds and scoringMode are required" },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createRoomService(db);

  try {
    const result = await service.startGame(code.toUpperCase(), playerId, {
      numRounds,
      scoringMode,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RoomNotFoundError) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (err instanceof NotHostError) {
      return NextResponse.json({ error: "Only the host can start the game" }, { status: 403 });
    }
    if (err instanceof InsufficientPlayersError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof InvalidConfigError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDebugService, DebugInvalidConfigError } from "@/lib/debug/debug-service";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const playerCount = typeof body.playerCount === "number" ? body.playerCount : undefined;

  if (playerCount === undefined) {
    return NextResponse.json({ error: "playerCount is required" }, { status: 400 });
  }

  const service = createDebugService(db);

  try {
    const session = await service.createSession(playerCount);
    return NextResponse.json(
      { sessionId: session.id, roomCode: session.roomCode, players: session.players },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof DebugInvalidConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

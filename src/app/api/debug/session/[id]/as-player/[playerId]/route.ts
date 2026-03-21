import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDebugService, DebugSessionNotFoundError } from "@/lib/debug/debug-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id, playerId } = await params;
  const service = createDebugService(db);

  let session;
  try {
    session = service.getSession(id);
  } catch (err) {
    if (err instanceof DebugSessionNotFoundError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    throw err;
  }

  const player = session.players.find((p) => p.playerId === playerId);
  if (!player) {
    return NextResponse.json({ error: "Player not in session" }, { status: 404 });
  }

  const res = NextResponse.redirect(new URL(`/room/${session.roomCode}`, _req.url), 302);
  res.cookies.set("playerId", playerId, { path: "/" });
  return res;
}

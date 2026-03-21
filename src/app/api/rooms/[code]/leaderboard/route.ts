import { NextRequest, NextResponse } from "next/server";
import { getPlayerId } from "@/lib/debug/get-player-id";
import { db } from "@/lib/db";
import { rooms, scores, players } from "@/lib/db/schema";
import { desc, eq, sum } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const playerId = await getPlayerId();

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, code.toUpperCase()));

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const leaderboard = await db
    .select({
      playerId: scores.playerId,
      nickname: players.nickname,
      totalPoints: sum(scores.points),
    })
    .from(scores)
    .innerJoin(players, eq(scores.playerId, players.id))
    .where(eq(scores.roomId, room.id))
    .groupBy(scores.playerId, players.nickname)
    .orderBy(desc(sum(scores.points)));

  return NextResponse.json({ leaderboard });
}

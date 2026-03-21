import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { rooms, scores, players } from "@/lib/db/schema";
import { desc, eq, sum } from "drizzle-orm";
import { createVoteService } from "@/lib/game/vote-service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

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

  if (room.hostPlayerId !== playerId) {
    return NextResponse.json({ error: "Only the host can tally votes" }, { status: 403 });
  }

  if (room.status !== "finished") {
    return NextResponse.json(
      { error: "Votes can only be tallied after the reveal is complete" },
      { status: 409 }
    );
  }

  // Tally votes into scores
  const service = createVoteService(db);
  await service.tallyVotes(room.id);

  // Fetch leaderboard to broadcast
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

  // Broadcast leaderboard to all clients
  await getAblyRest()
    .channels.get(channels.scoringComplete(code.toUpperCase()))
    .publish("scoring:complete", { leaderboard });

  return NextResponse.json({ leaderboard });
}

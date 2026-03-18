import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rooms, rounds } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const [room] = await db
    .select({ id: rooms.id, status: rooms.status, currentRound: rooms.currentRound })
    .from(rooms)
    .where(eq(rooms.code, code.toUpperCase()));

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // If in prompts phase, include the active round ID
  let roundId: string | null = null;
  if (room.status === "prompts") {
    const [round] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, 1)));
    roundId = round?.id ?? null;
  }

  return NextResponse.json({ status: room.status, roundId });
}

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

  // Include the active round ID for prompts and active phases
  let roundId: string | null = null;
  let currentPass: number | null = null;
  if (room.status === "prompts" || room.status === "active") {
    const roundNumber = Math.max(room.currentRound, 1);
    const [round] = await db
      .select({ id: rounds.id, currentPass: rounds.currentPass })
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, roundNumber)));
    roundId = round?.id ?? null;
    currentPass = round?.currentPass ?? null;
  }

  return NextResponse.json({ status: room.status, roundId, currentPass });
}

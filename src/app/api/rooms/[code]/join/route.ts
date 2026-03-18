import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { players, rooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createRoomService, RoomNotFoundError, DuplicateNicknameError } from "@/lib/rooms/service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const body = await req.json().catch(() => ({}));
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";

  if (!nickname) {
    return NextResponse.json({ error: "nickname is required" }, { status: 400 });
  }

  const service = createRoomService(db);

  try {
    const { playerId, seatOrder } = await service.joinRoom(code.toUpperCase(), nickname);

    const cookieStore = await cookies();
    cookieStore.set("playerId", playerId, { httpOnly: true, path: "/" });

    // Publish full updated player list so lobby subscribers get live updates
    const upperCode = code.toUpperCase();
    const [room] = await db.select().from(rooms).where(eq(rooms.code, upperCode));
    if (room) {
      const playerList = await db
        .select({ id: players.id, nickname: players.nickname, seatOrder: players.seatOrder })
        .from(players)
        .where(eq(players.roomId, room.id));
      playerList.sort((a, b) => a.seatOrder - b.seatOrder);
      await getAblyRest()
        .channels.get(channels.roomPlayers(upperCode))
        .publish("players-updated", { players: playerList, hostPlayerId: room.hostPlayerId });
    }

    return NextResponse.json({ playerId, seatOrder });
  } catch (err) {
    if (err instanceof RoomNotFoundError) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (err instanceof DuplicateNicknameError) {
      return NextResponse.json({ error: "Nickname already taken" }, { status: 409 });
    }
    throw err;
  }
}

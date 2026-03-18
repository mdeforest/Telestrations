import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createRoomService } from "@/lib/rooms/service";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";

  if (!nickname) {
    return NextResponse.json({ error: "nickname is required" }, { status: 400 });
  }

  const service = createRoomService(db);
  const room = await service.createRoom(nickname);

  const cookieStore = await cookies();
  cookieStore.set("playerId", room.hostPlayerId, { httpOnly: true, path: "/" });
  cookieStore.set("roomId", room.id, { httpOnly: true, path: "/" });

  return NextResponse.json({ roomId: room.id, code: room.code }, { status: 201 });
}

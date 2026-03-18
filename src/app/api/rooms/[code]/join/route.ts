import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createRoomService, RoomNotFoundError, DuplicateNicknameError } from "@/lib/rooms/service";

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

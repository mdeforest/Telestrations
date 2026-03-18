import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { players, rooms } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  const pid = req.nextUrl.searchParams.get("pid");
  if (!pid) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.code, upperCode));
  if (!room) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [player] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, pid), eq(players.roomId, room.id)));
  if (!player) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set("playerId", pid, { httpOnly: true, path: "/" });

  return NextResponse.redirect(new URL(`/room/${upperCode}`, req.url));
}

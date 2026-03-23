import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { players, rooms } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  const pid = req.nextUrl.searchParams.get("pid");
  if (!pid) {
    return NextResponse.json({ error: "pid is required" }, { status: 404 });
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.code, upperCode));
  if (!room) {
    return NextResponse.json({ error: "room not found" }, { status: 404 });
  }

  // One-time-use guard for the host QR.
  if (pid === room.hostPlayerId) {
    if (room.hostPhoneConnectedAt != null) {
      return NextResponse.json(
        { error: "This host QR has already been used. Ask the host to show you the player join code instead." },
        { status: 409 }
      );
    }
    // Race-safe claim: only succeeds if still unclaimed.
    const claimed = await db
      .update(rooms)
      .set({ hostPhoneConnectedAt: new Date() })
      .where(and(eq(rooms.code, upperCode), isNull(rooms.hostPhoneConnectedAt)))
      .returning({ id: rooms.id });
    if (claimed.length === 0) {
      return NextResponse.json(
        { error: "This host QR has already been used. Ask the host to show you the player join code instead." },
        { status: 409 }
      );
    }
  }

  // Look up player by id alone, then verify they belong to this room.
  // Simpler than an AND condition and produces clearer failure modes.
  const [player] = await db.select().from(players).where(eq(players.id, pid));
  if (!player || player.roomId !== room.id) {
    return NextResponse.json({ error: "player not found in room" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set("playerId", pid, { httpOnly: true, path: "/" });

  // Tell the host screen the phone has connected so it can hide the QR code.
  await getAblyRest()
    .channels.get(channels.roomPlayers(upperCode))
    .publish("host-phone-connected", null);

  // Use the Host header from the request for the redirect origin — req.url is
  // normalised to localhost by Next.js even when the phone hit the LAN IP.
  const reqHeaders = await headers();
  const host = reqHeaders.get("host") ?? "localhost:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return NextResponse.redirect(`${proto}://${host}/room/${upperCode}`);
}

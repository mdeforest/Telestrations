import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { rooms, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { HostLobby } from "./HostLobby";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function HostLobbyPage({ params }: Props) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  const [room] = await db.select().from(rooms).where(eq(rooms.code, upperCode));
  if (!room) notFound();

  const playerList = await db
    .select({ id: players.id, nickname: players.nickname, seatOrder: players.seatOrder })
    .from(players)
    .where(eq(players.roomId, room.id));

  playerList.sort((a, b) => a.seatOrder - b.seatOrder);

  // Derive base URL from the incoming request host so the QR code encodes
  // the correct address — critical for dev where the host accesses via local
  // IP (e.g. 192.168.x.x:3000) so the phone can reach the server.
  const reqHeaders = await headers();
  const host = reqHeaders.get("host") ?? "localhost:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  const connectUrl = `${proto}://${host}/room/${upperCode}/connect?pid=${room.hostPlayerId ?? ""}`;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <p className="text-sm text-gray-500 uppercase tracking-widest mb-1">Room Code</p>
      <h1 className="text-8xl font-black tracking-widest mb-10">{upperCode}</h1>

      <HostLobby
        code={upperCode}
        initialPlayers={playerList}
        hostPlayerId={room.hostPlayerId ?? ""}
        initialNumRounds={room.numRounds}
        initialScoringMode={room.scoringMode}
        connectUrl={connectUrl}
      />
    </main>
  );
}

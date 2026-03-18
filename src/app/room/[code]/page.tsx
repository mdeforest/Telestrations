import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { rooms, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { LobbyPlayerList } from "./LobbyPlayerList";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function LobbyPage({ params }: Props) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  const [room] = await db.select().from(rooms).where(eq(rooms.code, upperCode));
  if (!room) notFound();

  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  const isHost = Boolean(playerId && playerId === room.hostPlayerId);

  const playerList = await db
    .select({ id: players.id, nickname: players.nickname, seatOrder: players.seatOrder })
    .from(players)
    .where(eq(players.roomId, room.id));

  playerList.sort((a, b) => a.seatOrder - b.seatOrder);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <p className="text-sm text-gray-500 uppercase tracking-widest mb-1">Room Code</p>
      <h1 className="text-6xl font-black tracking-widest mb-8">{upperCode}</h1>
      <p className="text-gray-500 mb-6">Waiting for players…</p>

      <LobbyPlayerList
        code={upperCode}
        initialPlayers={playerList}
        hostPlayerId={room.hostPlayerId ?? ""}
        isHost={isHost}
        initialNumRounds={room.numRounds}
        initialScoringMode={room.scoringMode}
      />
    </main>
  );
}

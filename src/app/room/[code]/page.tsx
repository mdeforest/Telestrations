import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { rooms, players, rounds } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
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

  // Host always uses the host screen
  if (playerId && playerId === room.hostPlayerId) {
    redirect(`/room/${upperCode}/host`);
  }

  const playerList = await db
    .select({ id: players.id, nickname: players.nickname, seatOrder: players.seatOrder })
    .from(players)
    .where(eq(players.roomId, room.id));

  playerList.sort((a, b) => a.seatOrder - b.seatOrder);

  // If the room is already in the prompts phase (e.g. player refreshed), fetch the round ID
  let initialRoundId: string | undefined;
  if (room.status === "prompts") {
    const [firstRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, 1)));
    initialRoundId = firstRound?.id;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <p className="text-sm text-gray-500 uppercase tracking-widest mb-1">Room Code</p>
      <h1 className="text-6xl font-black tracking-widest mb-8">{upperCode}</h1>
      {room.status === "lobby" && (
        <p className="text-gray-500 mb-6">Waiting for players…</p>
      )}

      <LobbyPlayerList
        code={upperCode}
        initialPlayers={playerList}
        hostPlayerId={room.hostPlayerId ?? ""}
        initialStatus={room.status}
        initialRoundId={initialRoundId}
      />
    </main>
  );
}

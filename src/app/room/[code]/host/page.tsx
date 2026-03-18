import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { rooms, players, books, rounds } from "@/lib/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
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

  // If already in prompts phase (e.g. host refreshed), load current selection count
  let initialSelectedCount = 0;
  if (room.status === "prompts") {
    const [firstRound] = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, 1)));

    if (firstRound) {
      const [{ selected }] = await db
        .select({
          selected: sql<number>`cast(count(*) filter (where ${books.originalPrompt} != '') as integer)`,
        })
        .from(books)
        .where(and(eq(books.roundId, firstRound.id), ne(books.originalPrompt, "")));
      initialSelectedCount = selected;
    }
  }

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
        initialStatus={room.status}
        initialSelectedCount={initialSelectedCount}
      />
    </main>
  );
}

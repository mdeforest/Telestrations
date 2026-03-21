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

  let initialSelectedCount = 0;
  let initialRoundId: string | undefined;
  let initialTimerStartedAt: string | null = null;

  if (room.status === "prompts" || room.status === "active") {
    const [currentRound] = await db
      .select({ id: rounds.id, timerStartedAt: rounds.timerStartedAt })
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, Math.max(room.currentRound, 1))));

    if (currentRound) {
      initialRoundId = currentRound.id;
      initialTimerStartedAt = currentRound.timerStartedAt?.toISOString() ?? null;

      if (room.status === "prompts") {
        const [counts] = await db
          .select({ selected: sql<number>`cast(count(*) as integer)` })
          .from(books)
          .where(and(eq(books.roundId, currentRound.id), ne(books.originalPrompt, "")));
        initialSelectedCount = counts.selected;
      }
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
        initialStatus={room.status}
        initialSelectedCount={initialSelectedCount}
        initialRoundId={initialRoundId}
        initialTimerStartedAt={initialTimerStartedAt}
        initialRevealBookIndex={room.revealBookIndex}
        initialRevealEntryIndex={room.revealEntryIndex}
        initialScoringMode={room.scoringMode}
      />
    </main>
  );
}

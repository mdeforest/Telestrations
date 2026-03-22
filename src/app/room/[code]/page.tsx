import { notFound } from "next/navigation";
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
  const isHost = Boolean(playerId && playerId === room.hostPlayerId);

  const playerList = await db
    .select({ id: players.id, nickname: players.nickname, seatOrder: players.seatOrder })
    .from(players)
    .where(eq(players.roomId, room.id));

  playerList.sort((a, b) => a.seatOrder - b.seatOrder);

  let initialRoundId: string | undefined;
  let initialTimerStartedAt: string | null = null;

  if (room.status === "prompts" || room.status === "active") {
    const [currentRound] = await db
      .select({ id: rounds.id, timerStartedAt: rounds.timerStartedAt })
      .from(rounds)
      .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, Math.max(room.currentRound, 1))));
    initialRoundId = currentRound?.id;
    initialTimerStartedAt = currentRound?.timerStartedAt?.toISOString() ?? null;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-surface">
      <p className="text-sm text-on-surface-variant font-label uppercase tracking-[0.15em] mb-2 pl-1 transform rotate-1">
        Room Code
      </p>
      <div className="bg-secondary-container text-on-secondary-container px-8 py-4 rounded-2xl font-label text-5xl md:text-6xl tracking-[0.1em] font-bold mb-10 transform -rotate-1 shadow-sm">
        {upperCode}
      </div>
      {room.status === "lobby" && isHost && (
        <p className="text-sm text-on-surface-variant mb-8 font-body">
          Big screen?{" "}
          <a href={`/room/${upperCode}/host`} className="text-secondary font-bold underline hover:text-secondary-dim transition-colors">
            Open host view
          </a>
        </p>
      )}
      {room.status === "lobby" && !isHost && (
        <p className="text-on-surface-variant font-body mb-8 italic opacity-80">
          Waiting for host to start…
        </p>
      )}

      <div className="w-full max-w-md">
        <LobbyPlayerList
          code={upperCode}
          initialPlayers={playerList}
          hostPlayerId={room.hostPlayerId ?? ""}
          playerId={playerId ?? ""}
          isHost={isHost}
          initialNumRounds={room.numRounds}
          initialScoringMode={room.scoringMode}
          initialStatus={room.status}
          initialRoundId={initialRoundId}
          initialTimerStartedAt={initialTimerStartedAt}
          initialRevealBookIndex={room.revealBookIndex}
          initialRevealEntryIndex={room.revealEntryIndex}
        />
      </div>
    </main>
  );
}

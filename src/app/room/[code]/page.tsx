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
    <div className="bg-surface text-on-surface font-body min-h-screen flex flex-col">
      {/* TopAppBar */}
      <header className="bg-surface docked full-width top-0 z-50">
        <div className="flex justify-between items-center w-full px-6 py-4">
          <button className="hover:bg-surface-variant/50 rounded-full p-2 active:scale-95 transition-transform duration-150">
            <span className="material-symbols-outlined text-primary">help</span>
          </button>
          <h1 className="font-headline font-bold tracking-widest uppercase text-2xl font-black text-primary">Telestrations</h1>
          <button className="hover:bg-surface-variant/50 rounded-full p-2 active:scale-95 transition-transform duration-150 text-primary">
            <span className="material-symbols-outlined text-primary">settings</span>
          </button>
        </div>
        <div className="bg-surface-variant h-px w-full"></div>
      </header>

      {/* Main Content Area */}
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
  );
}

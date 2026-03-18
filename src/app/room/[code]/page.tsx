import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { rooms, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface Props {
  params: Promise<{ code: string }>;
}

export default async function LobbyPage({ params }: Props) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, upperCode));

  if (!room) notFound();

  const playerList = await db
    .select({ id: players.id, nickname: players.nickname, seatOrder: players.seatOrder })
    .from(players)
    .where(eq(players.roomId, room.id));

  playerList.sort((a, b) => a.seatOrder - b.seatOrder);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">Room {upperCode}</h1>
      <p className="text-gray-500 mb-8">Waiting for players…</p>

      <ul className="w-full max-w-xs space-y-2">
        {playerList.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 rounded-lg border px-4 py-3"
          >
            <span className="text-sm text-gray-400 w-5 text-right">{p.seatOrder}</span>
            <span className="font-medium">{p.nickname}</span>
            {p.id === room.hostPlayerId && (
              <span className="ml-auto text-xs text-blue-500">host</span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

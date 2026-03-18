"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";
import { HostPromptsWaiting } from "./HostPromptsWaiting";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  initialPlayers: Player[];
  hostPlayerId: string;
  initialStatus?: string;
  initialSelectedCount?: number;
}

export function HostLobby({
  code,
  initialPlayers,
  hostPlayerId,
  initialStatus = "lobby",
  initialSelectedCount = 0,
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const ably = getAblyClient();

    const playersCh = ably.channels.get(channels.roomPlayers(code));
    playersCh.subscribe("players-updated", (msg) => {
      const { players } = msg.data as { players: Player[]; hostPlayerId: string };
      setPlayerList(players);
    });

    const statusCh = ably.channels.get(channels.roomStatus(code));
    statusCh.subscribe("room-status-changed", (msg) => {
      const { status: newStatus } = msg.data as { status: string };
      if (newStatus === "active") {
        window.location.reload();
        return;
      }
      setStatus(newStatus);
    });

    return () => {
      playersCh.unsubscribe();
      statusCh.unsubscribe();
    };
  }, [code]);

  if (status === "prompts") {
    return (
      <HostPromptsWaiting
        code={code}
        totalPlayers={playerList.length}
        initialSelectedCount={initialSelectedCount}
      />
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
          Players ({playerList.length})
        </h2>
        <ul className="space-y-2">
          {playerList.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3 text-lg"
            >
              <span className="text-gray-400 w-6 text-right">{p.seatOrder}</span>
              <span className="font-medium">{p.nickname}</span>
              {p.id === hostPlayerId && (
                <span className="ml-auto text-xs text-blue-500">host</span>
              )}
            </li>
          ))}
        </ul>
        {playerList.length < 4 && (
          <p className="mt-3 text-sm text-amber-600">
            Waiting for players… ({playerList.length} / 4 minimum)
          </p>
        )}
      </section>

      <p className="text-sm text-gray-400 text-center">
        Waiting for the host to start the game.
      </p>
    </div>
  );
}

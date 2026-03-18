"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  initialPlayers: Player[];
  hostPlayerId: string;
}

export function LobbyPlayerList({ code, initialPlayers, hostPlayerId }: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [currentHostId, setCurrentHostId] = useState(hostPlayerId);

  useEffect(() => {
    const ably = getAblyClient();
    const channel = ably.channels.get(channels.roomPlayers(code));

    channel.subscribe("players-updated", (msg) => {
      const { players, hostPlayerId: newHostId } = msg.data as {
        players: Player[];
        hostPlayerId: string;
      };
      setPlayerList(players);
      setCurrentHostId(newHostId);
    });

    return () => {
      channel.unsubscribe();
    };
  }, [code]);

  return (
    <ul className="w-full max-w-xs space-y-2">
      {playerList.map((p) => (
        <li
          key={p.id}
          className="flex items-center gap-3 rounded-lg border px-4 py-3"
        >
          <span className="text-sm text-gray-400 w-5 text-right">{p.seatOrder}</span>
          <span className="font-medium">{p.nickname}</span>
          {p.id === currentHostId && (
            <span className="ml-auto text-xs text-blue-500">host</span>
          )}
        </li>
      ))}
    </ul>
  );
}

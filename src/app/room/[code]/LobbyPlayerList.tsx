"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";
import { PromptSelectionScreen } from "./PromptSelectionScreen";

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
  initialRoundId?: string;
}

export function LobbyPlayerList({
  code,
  initialPlayers,
  hostPlayerId,
  initialStatus = "lobby",
  initialRoundId,
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [currentHostId, setCurrentHostId] = useState(hostPlayerId);
  const [status, setStatus] = useState(initialStatus);
  const [roundId, setRoundId] = useState(initialRoundId ?? "");

  useEffect(() => {
    const ably = getAblyClient();

    // Player list updates
    const playersCh = ably.channels.get(channels.roomPlayers(code));
    playersCh.subscribe("players-updated", (msg) => {
      const { players, hostPlayerId: newHostId } = msg.data as {
        players: Player[];
        hostPlayerId: string;
      };
      setPlayerList(players);
      setCurrentHostId(newHostId);
    });

    // Room status changes (lobby → prompts → active)
    const statusCh = ably.channels.get(channels.roomStatus(code));
    statusCh.subscribe("room-status-changed", (msg) => {
      const { status: newStatus, roundId: newRoundId } = msg.data as {
        status: string;
        roundId?: string;
      };
      if (newStatus === "active") {
        window.location.reload();
        return;
      }
      setStatus(newStatus);
      if (newRoundId) setRoundId(newRoundId);
    });

    return () => {
      playersCh.unsubscribe();
      statusCh.unsubscribe();
    };
  }, [code]);

  if (status === "prompts" && roundId) {
    return <PromptSelectionScreen code={code} roundId={roundId} />;
  }

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

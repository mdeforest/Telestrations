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
  isHost?: boolean;
  initialStatus?: string;
  initialRoundId?: string;
}

export function LobbyPlayerList({
  code,
  initialPlayers,
  hostPlayerId,
  isHost = false,
  initialStatus = "lobby",
  initialRoundId,
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [currentHostId, setCurrentHostId] = useState(hostPlayerId);
  const [status, setStatus] = useState(initialStatus);
  const [roundId, setRoundId] = useState(initialRoundId ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

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

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numRounds: 3, scoringMode: "friendly" }),
      });
      if (!res.ok) {
        const data = await res.json();
        setStartError(data.error ?? "Failed to start");
        setStarting(false);
      }
    } catch {
      setStartError("Network error");
      setStarting(false);
    }
  }

  if (status === "prompts" && roundId) {
    return <PromptSelectionScreen roundId={roundId} />;
  }

  const canStart = playerList.length >= 4;

  return (
    <div className="w-full max-w-xs flex flex-col gap-4">
      <ul className="space-y-2">
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

      {isHost && (
        <div className="flex flex-col gap-2">
          {startError && <p className="text-sm text-red-600">{startError}</p>}
          {!canStart && (
            <p className="text-sm text-amber-600">
              Need at least 4 players ({4 - playerList.length} more)
            </p>
          )}
          <button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="w-full py-3 rounded-xl text-lg font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            {starting ? "Starting…" : "Start Game"}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";
import { PromptSelectionScreen } from "./PromptSelectionScreen";
import { DrawingPhaseScreen } from "./DrawingPhaseScreen";
import { GuessingPhaseScreen } from "./GuessingPhaseScreen";
import { PlayerRevealScreen } from "./PlayerRevealScreen";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  initialPlayers: Player[];
  hostPlayerId: string;
  playerId: string;
  isHost: boolean;
  initialNumRounds: number;
  initialScoringMode: "friendly" | "competitive";
  initialStatus?: string;
  initialRoundId?: string;
  initialTimerStartedAt?: string | null;
  initialRevealBookIndex?: number;
  initialRevealEntryIndex?: number;
}

export function LobbyPlayerList({
  code,
  initialPlayers,
  hostPlayerId,
  playerId,
  isHost,
  initialNumRounds,
  initialScoringMode,
  initialStatus = "lobby",
  initialRoundId,
  initialTimerStartedAt = null,
  initialRevealBookIndex = 0,
  initialRevealEntryIndex = 0,
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [currentHostId, setCurrentHostId] = useState(hostPlayerId);
  const [numRounds, setNumRounds] = useState(initialNumRounds);
  const [scoringMode, setScoringMode] = useState<"friendly" | "competitive">(initialScoringMode);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [roundId, setRoundId] = useState(initialRoundId ?? "");
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(initialTimerStartedAt);
  const [passType, setPassType] = useState<"drawing" | "guess" | null>(null);
  const [incomingDrawing, setIncomingDrawing] = useState<string | null>(null);
  const [revealBookIndex, setRevealBookIndex] = useState(initialRevealBookIndex);
  const [revealEntryIndex, setRevealEntryIndex] = useState(initialRevealEntryIndex);

  const canStart = playerList.length >= 4;

  useEffect(() => {
    const ably = getAblyClient();

    const playersCh = ably.channels.get(channels.roomPlayers(code));
    playersCh.subscribe("players-updated", (msg) => {
      const { players, hostPlayerId: newHostId } = msg.data as {
        players: Player[];
        hostPlayerId: string;
      };
      setPlayerList(players);
      setCurrentHostId(newHostId);
    });

    const statusCh = ably.channels.get(channels.roomStatus(code));
    statusCh.subscribe("room-status-changed", (msg) => {
      const { status: newStatus, roundId: newRoundId, timerStartedAt: newTimer } = msg.data as {
        status: string;
        roundId?: string;
        timerStartedAt?: string | null;
      };
      setStatus(newStatus);
      if (newRoundId) setRoundId(newRoundId);
      if (newTimer !== undefined) setTimerStartedAt(newTimer);
      // Reset pass type whenever we leave the active phase so the next round
      // doesn't briefly show the wrong phase screen before my-entry resolves.
      if (newStatus !== "active") {
        setPassType(null);
        setIncomingDrawing(null);
      }
    });

    const revealCh = ably.channels.get(channels.revealAdvance(code));
    revealCh.subscribe("reveal:advance", (msg) => {
      const { revealBookIndex: bIdx, revealEntryIndex: eIdx } = msg.data as {
        revealBookIndex: number;
        revealEntryIndex: number;
        finished: boolean;
      };
      setRevealBookIndex(bIdx);
      setRevealEntryIndex(eIdx);
    });

    return () => {
      playersCh.unsubscribe();
      statusCh.unsubscribe();
      revealCh.unsubscribe();
    };
  }, [code]);

  // When the game is active, load the current pass type from my-entry.
  // Re-runs when roundId changes (next round) or on pass-advanced (reload resets state).
  useEffect(() => {
    if (status !== "active" || !roundId) return;

    fetch(`/api/rounds/${roundId}/my-entry`)
      .then((r) => r.json())
      .then((data: { type?: "drawing" | "guess"; incomingContent?: string | null }) => {
        if (data.type) setPassType(data.type);
        setIncomingDrawing(data.incomingContent ?? null);
      })
      .catch(() => {/* non-fatal — defaults to drawing */});
  }, [status, roundId]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numRounds, scoringMode }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to start game");
        setStarting(false);
      }
    } catch {
      setError("Network error");
      setStarting(false);
    }
  }

  if (status === "prompts" && roundId) {
    return <PromptSelectionScreen roundId={roundId} />;
  }

  if (status === "reveal" || status === "finished") {
    return (
      <PlayerRevealScreen
        code={code}
        playerId={playerId}
        isHost={isHost}
        initialBookIndex={revealBookIndex}
        initialEntryIndex={revealEntryIndex}
      />
    );
  }

  if (status === "active" && roundId) {
    if (passType === "guess") {
      return (
        <GuessingPhaseScreen
          code={code}
          roundId={roundId}
          playerId={playerId}
          timerStartedAt={timerStartedAt}
          incomingDrawing={incomingDrawing}
        />
      );
    }
    return (
      <DrawingPhaseScreen
        code={code}
        roundId={roundId}
        playerId={playerId}
        timerStartedAt={timerStartedAt}
      />
    );
  }

  return (
    <div className="w-full max-w-xs flex flex-col gap-6">
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
        <section className="flex flex-col gap-4 border-t pt-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">
            Host Controls
          </h2>

          {!canStart && (
            <p className="text-sm text-amber-600">
              Need at least 4 players to start ({4 - playerList.length} more)
            </p>
          )}

          <div className="flex items-center justify-between">
            <label htmlFor="rounds" className="font-medium">
              Rounds
            </label>
            <select
              id="rounds"
              value={numRounds}
              onChange={(e) => setNumRounds(Number(e.target.value))}
              className="border rounded px-3 py-1.5 text-base bg-white"
            >
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-medium">Scoring</span>
            <div className="flex rounded-lg border overflow-hidden text-sm">
              {(["friendly", "competitive"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setScoringMode(mode)}
                  className={`px-4 py-1.5 capitalize transition-colors ${
                    scoringMode === mode
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="w-full py-3 rounded-xl text-lg font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            {starting ? "Starting…" : "Start Game"}
          </button>
        </section>
      )}
    </div>
  );
}

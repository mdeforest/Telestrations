"use client";

import { useEffect, useState } from "react";
import { getAblyClient, resetAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";
import { debugFetch } from "@/lib/debug/debug-fetch";
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
    // If this tab was opened via the debug "Open as Player" link, extract the
    // debugPlayerId URL param, persist it to sessionStorage, and strip from URL.
    // Must happen before getAblyClient() so the token request carries the header.
    const urlParams = new URLSearchParams(window.location.search);
    const debugId = urlParams.get("debugPlayerId");
    if (debugId) {
      sessionStorage.setItem("debugPlayerId", debugId);
      urlParams.delete("debugPlayerId");
      const newSearch = urlParams.toString();
      history.replaceState(
        null,
        "",
        window.location.pathname + (newSearch ? `?${newSearch}` : "")
      );
      resetAblyClient();
    }

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

    debugFetch(`/api/rounds/${roundId}/my-entry`)
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
      const res = await debugFetch(`/api/rooms/${code}/start`, {
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
        scoringMode={scoringMode}
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
    <div className="w-full max-w-md flex flex-col gap-6 font-body">
      <ul className="flex flex-col gap-4">
        {playerList.map((p, index) => (
          <li
            key={p.id}
            className={`flex items-center gap-4 rounded-2xl px-5 py-4 ${
              index % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container-high"
            } transform ${index % 2 === 0 ? "-rotate-1" : "rotate-1"}`}
          >
            <span className="text-sm font-label text-on-surface-variant w-5 text-right font-bold opacity-70">
              {p.seatOrder}
            </span>
            <span className="font-bold text-on-surface text-xl font-display">{p.nickname}</span>
            {p.id === currentHostId && (
              <span className="ml-auto text-xs font-bold font-label uppercase tracking-widest text-secondary opacity-90">
                host
              </span>
            )}
          </li>
        ))}
      </ul>

      {isHost && (
        <section className="flex flex-col gap-6 mt-4 bg-surface-container p-6 sm:p-8 rounded-[2rem] shadow-ambient transform -rotate-1">
          <h2 className="text-sm font-bold font-label text-on-surface-variant uppercase tracking-[0.15em]">
            Host Controls
          </h2>

          {!canStart && (
            <p className="text-sm font-bold text-error bg-error-container/20 px-4 py-3 rounded-xl transform rotate-1">
              Need at least 4 players to start ({4 - playerList.length} more)
            </p>
          )}

          <div className="flex items-center justify-between">
            <label htmlFor="rounds" className="font-bold font-display text-lg text-on-surface">
              Rounds
            </label>
            <select
              id="rounds"
              value={numRounds}
              onChange={(e) => setNumRounds(Number(e.target.value))}
              className="bg-surface-container-lowest rounded-xl px-4 py-2 text-lg font-bold font-body text-on-surface ring-1 ring-outline-variant/15 focus:ring-outline-variant/40 focus:outline-none transition-all cursor-pointer"
            >
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-bold font-display text-lg text-on-surface">Scoring Mode</span>
            <div className="flex rounded-xl bg-surface-container-lowest p-1 ring-1 ring-outline-variant/15">
              {(["friendly", "competitive"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setScoringMode(mode)}
                  className={`flex-1 px-4 py-3 rounded-lg capitalize font-bold transition-all ${
                    scoringMode === mode
                      ? "bg-secondary text-on-secondary shadow-sm"
                      : "bg-transparent text-on-surface-variant hover:bg-surface-container-low"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm font-bold text-error bg-error-container/20 px-4 py-3 rounded-xl">{error}</p>}

          <button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="w-full mt-2 py-4 rounded-xl text-xl font-black font-display bg-primary text-on-primary shadow-sketch shadow-primary-dim active:shadow-none active:translate-y-[2px] active:translate-x-[2px] active:scale-[0.98] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:translate-x-0 disabled:active:shadow-sketch disabled:active:scale-100 transition-all transform rotate-1"
          >
            {starting ? "Starting…" : "Start Game"}
          </button>
        </section>
      )}
    </div>
  );
}

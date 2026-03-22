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
    <main className="flex-grow container mx-auto px-4 py-8 max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Players List */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="bg-surface-container-low p-8 rounded-lg paper-stack-1 border-outline-variant/10 border relative shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline text-2xl font-extrabold text-primary">Players Joined</h2>
              <span className="font-label bg-secondary-container text-on-secondary-container px-4 py-1 rounded-full text-sm font-bold uppercase tracking-wider">
                {playerList.length} / 8
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* Player Card */}
              {playerList.map((p, index) => {
                const isHostPlayer = p.id === currentHostId;
                const initials = p.nickname.slice(0, 2).toUpperCase();
                // Pick alternating colors to match the stitched mock
                const bgColor = index % 3 === 0 ? "bg-primary-container text-on-primary-container border-primary" 
                              : index % 3 === 1 ? "bg-secondary-container text-on-secondary-container border-secondary"
                                                : "bg-tertiary-container text-on-tertiary-container border-tertiary";
                return (
                  <div key={p.id} className="bg-surface-container-lowest p-4 rounded-lg flex flex-col items-center gap-3 border border-outline-variant/10 shadow-sm">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center font-headline text-xl font-bold border-2 ${bgColor}`}>
                        {initials}
                    </div>
                    <span className="font-semibold text-center truncate w-full">{p.nickname} {isHostPlayer ? "(Host)" : ""}</span>
                  </div>
                );
              })}
              
              {/* Empty Slots */}
              {Array.from({ length: Math.max(0, 8 - playerList.length) }).map((_, i) => (
                <div key={i} className="bg-surface-container-high/30 p-4 rounded-lg flex flex-col items-center justify-center gap-2 border-2 border-dashed border-outline-variant/20 h-32">
                  <span className="material-symbols-outlined text-outline-variant">person_add</span>
                  <span className="font-label text-xs text-outline-variant uppercase">Waiting...</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Game Tip */}
          <div className="bg-tertiary-container/20 p-6 rounded-lg border-2 border-tertiary/20 flex items-start gap-4 shadow-sm">
            <span className="material-symbols-outlined text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>lightbulb</span>
            <p className="text-sm font-medium italic text-on-surface">Tip: Don't worry about being a good artist! The funniest rounds come from the most "creative" interpretations.</p>
          </div>
        </div>

        {/* Right Column: Host Controls / Status */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {isHost ? (
            /* Host View Container */
            <div className="bg-surface-container-lowest p-8 rounded-lg paper-stack-2 border-outline-variant/20 border shadow-sm">
              <h2 className="font-headline text-2xl font-extrabold text-secondary mb-8">Game Settings</h2>
              
              {/* Rounds Selector */}
              <div className="mb-8">
                <label className="font-label text-xs font-bold text-outline uppercase mb-3 block">Number of Rounds</label>
                <div className="flex items-center justify-between bg-surface-container-low p-2 rounded-full border border-outline-variant/10">
                  <button 
                    onClick={() => setNumRounds(Math.max(3, numRounds - 1))}
                    className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center hover:bg-surface-variant transition-colors active:scale-90"
                  >
                    <span className="material-symbols-outlined font-bold">remove</span>
                  </button>
                  <span className="font-headline text-2xl font-black">{numRounds}</span>
                  <button 
                    onClick={() => setNumRounds(Math.min(8, numRounds + 1))}
                    className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center hover:bg-surface-variant transition-colors active:scale-90"
                  >
                    <span className="material-symbols-outlined font-bold">add</span>
                  </button>
                </div>
                <p className="text-[10px] text-outline mt-2 px-2 uppercase font-label">Estimated time: {numRounds * 3} mins</p>
              </div>

              {/* Scoring Toggle */}
              <div className="mb-10">
                <label className="font-label text-xs font-bold text-outline uppercase mb-3 block">Scoring Mode</label>
                <div className="grid grid-cols-2 gap-2 bg-surface-container-low p-1 rounded-xl">
                  {(["friendly", "competitive"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setScoringMode(mode)}
                      className={`py-3 px-4 rounded-lg font-bold text-sm capitalize transition-all active:scale-95 ${
                        scoringMode === mode
                          ? "bg-surface-container-lowest text-secondary sketch-shadow-secondary border border-secondary"
                          : "text-outline-variant hover:bg-surface-container-high border border-transparent"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Room Code Display */}
              <div className="bg-secondary-container/30 p-6 rounded-xl text-center mb-8 border border-secondary/10">
                <span className="font-label text-xs font-bold text-secondary uppercase block mb-1">Room Code</span>
                <div className="font-label text-4xl font-extrabold tracking-[0.2em] text-on-secondary-container">{code}</div>
              </div>

              {/* Start Button */}
              <div className="flex flex-col gap-3">
                {error && <p className="text-center text-sm font-bold text-error bg-error-container/20 px-4 py-3 rounded-xl">{error}</p>}
                <button
                  onClick={handleStart}
                  disabled={!canStart || starting}
                  className={`w-full py-5 rounded-xl font-headline text-xl font-extrabold flex items-center justify-center gap-3 transition-all ${
                    canStart && !starting
                      ? "bg-primary text-on-primary sketch-shadow-primary active:scale-95 active:shadow-none"
                      : "bg-surface-container-lowest border-2 border-outline-variant/30 text-outline-variant cursor-not-allowed grayscale"
                  }`}
                >
                  <span className="material-symbols-outlined">{starting ? "hourglass_empty" : "play_arrow"}</span>
                  {starting ? "Starting..." : "Start Game"}
                </button>
                {!canStart && (
                  <p className="text-center text-xs font-bold text-error uppercase font-label">Need {4 - playerList.length} more player{4 - playerList.length !== 1 ? 's' : ''} to start</p>
                )}
              </div>
            </div>
          ) : (
            /* Waiting View */
            <div className="bg-surface-container-lowest p-8 rounded-lg paper-stack-2 border-outline-variant/20 border shadow-sm text-center py-16">
              <div className="bg-secondary-container/30 w-full p-6 rounded-xl text-center mb-10 border border-secondary/10 shadow-sm">
                <span className="font-label text-xs font-bold text-secondary uppercase block mb-1 tracking-widest">Room Code</span>
                <div className="font-label text-4xl font-extrabold tracking-[0.2em] text-on-secondary-container">{code}</div>
              </div>

              <div className="mb-8 flex justify-center">
                <div className="w-24 h-24 bg-surface-container-low rounded-full flex items-center justify-center relative">
                  <span className="material-symbols-outlined text-5xl text-primary animate-bounce">brush</span>
                  <div className="absolute inset-0 rounded-full border-4 border-dashed border-primary/20 animate-spin" style={{ animationDuration: "10s" }}></div>
                </div>
              </div>
              <h2 className="font-headline text-2xl font-extrabold mb-4 text-on-surface">Waiting for host...</h2>
              <p className="text-on-surface-variant font-medium">The host is currently picking the perfect game settings. Get your digital pens ready!</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

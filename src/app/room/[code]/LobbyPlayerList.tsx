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
  const [passVersion, setPassVersion] = useState(0);

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

    const passCh = ably.channels.get(channels.roundPass(code));
    passCh.subscribe("pass-advanced", () => {
      setPassType(null);
      setIncomingDrawing(null);
      setPassVersion((v) => v + 1);
    });

    return () => {
      playersCh.unsubscribe();
      statusCh.unsubscribe();
      revealCh.unsubscribe();
      passCh.unsubscribe();
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
  }, [status, roundId, passVersion]);

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
          key={passVersion}
          code={code}
          roundId={roundId}
          playerId={playerId}
          timerStartedAt={timerStartedAt}
          incomingDrawing={incomingDrawing}
          players={playerList}
        />
      );
    }
    return (
      <DrawingPhaseScreen
        key={passVersion}
        code={code}
        roundId={roundId}
        playerId={playerId}
        timerStartedAt={timerStartedAt}
        players={playerList}
      />
    );
  }

  if (isHost) {
    return (
      <>
        <div className="px-4 pt-4 flex justify-center">
          <span className="bg-primary text-on-primary text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full font-label">
            👑 You&apos;re the Host
          </span>
        </div>
        <main className="flex-grow flex flex-col lg:flex-row p-6 lg:p-12 gap-8 lg:gap-12 pb-40 overflow-y-auto w-full max-w-[1400px] mx-auto">
          {/* Left: Tips Panel */}
          <section className="w-full lg:w-1/3 flex flex-col gap-6 shrink-0">
            <div className="bg-tertiary-container/30 rounded-xl p-6 flex items-center gap-4">
              <span className="material-symbols-outlined text-tertiary text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>lightbulb</span>
              <div>
                <p className="font-bold text-on-tertiary-container font-headline tracking-tight">Pro Tip</p>
                <p className="text-sm text-on-tertiary-container/80 font-medium">The game is best with 6+ players for maximum chaos!</p>
              </div>
            </div>
          </section>

          {/* Right: Players Grid */}
          <section className="flex-grow flex flex-col gap-6 overflow-hidden max-w-full">
            <div className="flex justify-between items-end">
              <h3 className="font-headline text-3xl font-black text-secondary tracking-tight">Joined Players ({playerList.length}/8)</h3>
              <span className="font-label text-on-surface-variant font-bold text-sm">
                {8 - playerList.length > 0 ? `Waiting for ${8 - playerList.length} more...` : "Room is full!"}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6 content-start pb-10">
              {playerList.map((p, index) => {
                const isHostPlayer = p.id === currentHostId;
                const initials = p.nickname.slice(0, 2).toUpperCase();
                
                // Varied tilt/rotation for players to match living doodle
                const rotation = index % 3 === 0 ? "transform -rotate-1" : index % 3 === 1 ? "transform rotate-2" : "transform -rotate-2";
                const bgRound = index % 3 === 0 ? "bg-secondary text-on-secondary sketch-shadow-secondary" : index % 3 === 1 ? "bg-primary-container text-on-primary-container" : "bg-tertiary-container text-on-tertiary-container";
                const cardBg = index % 2 === 0 ? "bg-surface-container-lowest" : "bg-surface-container-low";
                
                return (
                  <div key={p.id} className={`${cardBg} p-6 rounded-xl flex flex-col items-center gap-3 ${rotation} relative shadow-sm border border-outline-variant/10 transition-transform hover:scale-105`}>
                    <div className="relative">
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center font-headline text-3xl font-bold ${bgRound}`}>
                        {initials}
                      </div>
                      {isHostPlayer && (
                        <div className="absolute -top-2 -right-2 bg-primary text-white text-[10px] px-2 py-1 rounded-full font-label uppercase font-bold tracking-widest shadow-sm">Host</div>
                      )}
                    </div>
                    <span className="font-headline text-lg font-bold truncate w-full text-center text-on-surface">{p.nickname}</span>
                    <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                  </div>
                );
              })}

              {/* Empty Seats */}
              {Array.from({ length: Math.max(0, 8 - playerList.length) }).map((_, i) => (
                <div key={i} className="border-4 border-dashed border-outline-variant/20 p-6 rounded-xl flex flex-col items-center justify-center gap-2 opacity-60 min-h-[160px] bg-surface-container-lowest/50">
                  <span className="material-symbols-outlined text-4xl text-outline-variant">person_add</span>
                  <span className="font-label text-xs uppercase tracking-wider font-bold text-outline-variant">Seat {playerList.length + i + 1}</span>
                </div>
              ))}
            </div>
          </section>
        </main>

        {/* Footer Settings & Actions */}
        <footer className="bg-surface-container-lowest/95 backdrop-blur-md fixed bottom-0 left-0 w-full z-50 rounded-t-[3rem] border-t-2 border-outline-variant/30 shadow-[0px_-20px_40px_rgba(49,46,41,0.08)]">
          <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center px-8 lg:px-16 py-6 lg:py-8 gap-6 md:gap-0">
            <div className="flex flex-col md:flex-row gap-8 lg:gap-12 items-center">
              <div className="flex flex-col items-center md:items-start">
                <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold mb-3">Game Settings</span>
                <div className="flex gap-6 items-center">
                  <div className="flex flex-col items-center md:items-start">
                    <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Rounds</span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setNumRounds(Math.max(3, numRounds - 1))} className="text-secondary hover:text-primary active:scale-90 transition-all">
                         <span className="material-symbols-outlined">remove_circle</span>
                      </button>
                      <span className="font-headline text-2xl font-extrabold text-on-surface w-4 text-center">{numRounds}</span>
                      <button onClick={() => setNumRounds(Math.min(8, numRounds + 1))} className="text-secondary hover:text-primary active:scale-90 transition-all">
                         <span className="material-symbols-outlined">add_circle</span>
                      </button>
                    </div>
                  </div>
                  <div className="h-10 w-px bg-outline-variant/30"></div>
                  <div className="flex flex-col items-center md:items-start group cursor-pointer" onClick={() => setScoringMode(scoringMode === "friendly" ? "competitive" : "friendly")}>
                    <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Scoring Mode</span>
                    <div className="flex items-center gap-2">
                      <span className="font-headline text-xl font-extrabold text-on-surface capitalize">{scoringMode}</span>
                      <span className="material-symbols-outlined text-secondary text-sm group-hover:rotate-180 transition-transform">swap_vert</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="hidden xl:block h-12 w-px bg-outline-variant/30"></div>
              <div className="hidden xl:block text-outline font-label uppercase tracking-widest text-sm font-bold">
                {playerList.length} of 8 players ready
              </div>
            </div>
            
            <div className="flex items-center gap-4 lg:gap-8 w-full md:w-auto justify-between md:justify-end">
              <div className="flex flex-col items-center bg-secondary-container/30 px-6 py-2 rounded-xl border border-secondary/10">
                <span className="font-label text-[10px] font-bold text-secondary uppercase tracking-widest mb-0.5">Room Code</span>
                <span className="font-headline text-2xl font-black tracking-widest text-on-secondary-container">{code}</span>
              </div>
              <div className="flex items-center relative">
                <button
                  onClick={handleStart}
                  disabled={!canStart || starting}
                  className={`rounded-full px-8 lg:px-12 py-4 lg:py-5 font-headline font-bold text-lg lg:text-xl flex items-center gap-3 transition-all ${
                    canStart && !starting
                      ? "bg-primary text-on-primary hover:-translate-y-1 hover:shadow-lg active:scale-95 active:shadow-md sketch-shadow-primary"
                      : "bg-surface-container-highest text-outline-variant cursor-not-allowed opacity-80"
                  }`}
                >
                  <span>{starting ? "Starting..." : "Start Game"}</span>
                  <span className="material-symbols-outlined font-bold">{starting ? "hourglass_empty" : "play_arrow"}</span>
                </button>
                {error && <div className="absolute -top-12 right-0 bg-error text-on-error font-label text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-lg animate-bounce sketch-shadow">{error}</div>}
              </div>
            </div>
          </div>
        </footer>
        {!canStart && (
          <div className="fixed bottom-36 md:bottom-32 right-8 md:right-16 bg-error-container text-on-error-container px-4 py-2 rounded-xl font-label text-xs uppercase font-bold animate-bounce shadow-lg z-50 sketch-shadow border-2 border-error">
            Min. 4 Players Required
          </div>
        )}
      </>
    );
  }

  // Player View (Not Host)
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
            <p className="text-sm font-medium italic text-on-surface">Tip: Don&apos;t worry about being a good artist! The funniest rounds come from the most &ldquo;creative&rdquo; interpretations.</p>
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

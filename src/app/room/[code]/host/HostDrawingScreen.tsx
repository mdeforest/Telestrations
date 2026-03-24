"use client";

import { useEffect, useState } from "react";
import Ably from "ably";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

const ROUND_DURATION_SECONDS = 60;

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  roundId: string;
  /** ISO string from the server; null means the timer hasn't started yet */
  timerStartedAt: string | null;
  players: Player[];
}

interface DrawingStatus {
  timerStartedAt: string | null;
  currentPass: number;
  pendingNicknames: string[];
  disconnectedNicknames: string[];
}

/**
 * Host TV view for the drawing phase.
 *
 * Shows:
 * - A server-authoritative countdown timer
 * - Which players haven't submitted yet
 * - Which players are disconnected
 */
export function HostDrawingScreen({ code, roundId, timerStartedAt: initialTimer, players }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number>(ROUND_DURATION_SECONDS);
  const [status, setStatus] = useState<DrawingStatus>({
    timerStartedAt: initialTimer,
    currentPass: 1,
    pendingNicknames: [],
    disconnectedNicknames: [],
  });

  // Load on mount and on pass-advanced events
  useEffect(() => {
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch(`/api/rounds/${roundId}/drawing-status`);
        if (res.ok && !cancelled) {
          const data: DrawingStatus = await res.json();
          setStatus(data);
        }
      } catch {/* non-fatal */}
    }

    fetchStatus();

    const ably = getAblyClient();

    // Refresh pending list when any entry is submitted or a pass advances
    const passCh = ably.channels.get(channels.roundPass(code));
    const onPassAdvanced = () => { fetchStatus(); };
    const onEntrySubmitted = () => { fetchStatus(); };
    passCh.subscribe("pass-advanced", onPassAdvanced);
    passCh.subscribe("entry-submitted", onEntrySubmitted);

    // Update disconnected list when a player's connection status changes
    const playersCh = ably.channels.get(channels.roomPlayers(code));
    const onConnectionChanged = () => { fetchStatus(); };
    playersCh.subscribe("player-connection-changed", onConnectionChanged);

    // Subscribe to Ably presence leave/enter events and persist to DB
    const onPresenceChange = (member: Ably.PresenceMessage) => {
      const data = member.data as { playerId?: string } | undefined;
      const pid = data?.playerId;
      if (!pid) return;
      const isConnected = member.action === "enter" || member.action === "present";
      fetch(`/api/players/${pid}/connection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isConnected }),
      }).catch(() => {/* non-fatal */});
    };
    playersCh.presence.subscribe(onPresenceChange);

    return () => {
      cancelled = true;
      passCh.unsubscribe("pass-advanced", onPassAdvanced);
      passCh.unsubscribe("entry-submitted", onEntrySubmitted);
      playersCh.unsubscribe("player-connection-changed", onConnectionChanged);
      playersCh.presence.unsubscribe(onPresenceChange);
    };
  }, [roundId, code]);

  // Countdown — recomputes every second from server-authoritative timerStartedAt
  useEffect(() => {
    const timerStartedAt = status.timerStartedAt;
    if (!timerStartedAt) return;
    const startMs = new Date(timerStartedAt).getTime();

    function tick() {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const remaining = Math.max(0, ROUND_DURATION_SECONDS - elapsed);
      setSecondsLeft(remaining);
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status.timerStartedAt]);

  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeLabel = `${minutes}:${String(secs).padStart(2, "0")}`;
  const timerUrgent = secondsLeft <= 10;
  const timerDone = secondsLeft === 0;

  const submittedCount = players.length - status.pendingNicknames.length;
  const percentage = Math.round((submittedCount / players.length) * 100) || 0;

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen selection:bg-primary-container selection:text-on-primary-container w-full absolute top-0 left-0 right-0 z-10">
      {/* TopAppBar */}
      <nav className="fixed top-0 left-0 w-full z-50 bg-[#fcf6ed]/95 backdrop-blur-md px-8 py-6 flex justify-between items-center max-w-full lg:px-12 border-b-2 border-outline-variant/10 shadow-sm">
        <div className="flex items-center gap-6">
          <span className="text-3xl font-black text-primary truncate max-w-[200px] md:max-w-none">The Animated Sketchpad</span>
          <div className="bg-surface-variant h-8 w-1 mx-2 hidden md:block"></div>
          <h1 className="text-on-surface font-headline font-extrabold truncate hidden md:block">Round {status.currentPass}: Drawing Phase</h1>
        </div>
        <div className="flex items-center gap-6">
          {/* Timer Component */}
          <div className={`px-6 py-2 rounded-xl flex items-center gap-3 border-2 shadow-sm transition-colors ${timerUrgent ? "bg-error-container border-error text-on-error-container animate-pulse" : "bg-tertiary-container border-tertiary text-on-tertiary-container"}`}>
            <span className="material-symbols-outlined text-inherit">timer</span>
            <span className="font-label font-bold text-2xl tracking-tighter">
              {timerDone ? "00:00" : timeLabel}
            </span>
          </div>
        </div>
      </nav>

      {/* Content Canvas */}
      <main className="pt-32 pb-40 px-6 lg:px-12 paper-texture min-h-[100dvh]">
        {/* Room Code & Info */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
          <div>
            <p className="font-label uppercase tracking-widest text-on-surface-variant mb-2">Room Code</p>
            <div className="bg-secondary-container text-secondary font-label font-bold text-4xl px-8 py-3 rounded-lg tracking-[0.2em] sketch-shadow-secondary inline-block border border-secondary/20">
              {code}
            </div>
          </div>
          <div className="md:text-right bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
            <h2 className="font-headline text-xl font-bold text-on-surface-variant">Waiting for artists...</h2>
            <p className="font-body text-outline font-medium">Everyone is doodling their prompts</p>
          </div>
        </div>

        {/* Players Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8 max-w-[1600px] mx-auto">
          {players.map((p, index) => {
            const isPending = status.pendingNicknames.includes(p.nickname);
            const isDisconnected = status.disconnectedNicknames.includes(p.nickname);
            const initials = p.nickname.slice(0, 2).toUpperCase();
            
            // Replicate the living doodle tilts
            const rotation = index % 4 === 0 ? "hover:-rotate-1" : index % 4 === 1 ? "hover:rotate-1" : index % 4 === 2 ? "hover:-rotate-2 transform rotate-1" : "hover:rotate-2 transform -rotate-1";
            const avatarBg = index % 3 === 0 ? "bg-secondary-fixed border-secondary text-secondary-dim" : index % 3 === 1 ? "bg-primary-fixed border-primary text-primary-dim" : "bg-tertiary-fixed border-tertiary text-tertiary-dim";
            const roleBg = index % 3 === 0 ? "bg-secondary/10 text-secondary" : index % 3 === 1 ? "bg-primary/10 text-primary" : "bg-tertiary/20 text-tertiary-dim";

            return (
              <div key={p.id} className={`${!isPending ? "bg-surface-container-lowest sketch-shadow-primary border-primary border-2" : "bg-surface-container-low border-outline-variant/20 border-2 shadow-sm"} p-6 rounded-lg relative group transition-transform ${rotation}`}>
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 mb-6">
                  <div className={`w-16 h-16 shrink-0 rounded-full flex items-center justify-center border-2 overflow-hidden font-headline text-2xl font-black ${avatarBg} ${isDisconnected ? "grayscale opacity-50" : ""}`}>
                    {initials}
                  </div>
                  <div className="flex flex-col items-center sm:items-start min-w-0">
                    <h3 className="font-headline font-extrabold text-xl truncate w-full" title={p.nickname}>{p.nickname}</h3>
                    <span className={`font-label text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mt-1 inline-block ${roleBg}`}>Artist</span>
                  </div>
                </div>

                {isDisconnected ? (
                  <div className="bg-surface-variant text-on-surface-variant py-3 px-4 rounded-xl flex items-center justify-center gap-2 border border-outline-variant/30">
                    <span className="material-symbols-outlined text-sm">wifi_off</span>
                    <span className="font-label font-bold uppercase tracking-wider text-xs">Offline</span>
                  </div>
                ) : !isPending ? (
                  <div className="bg-primary-container text-on-primary-container py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    <span className="font-label font-bold uppercase tracking-wider text-xs">Submitted!</span>
                  </div>
                ) : (
                  <div className="bg-surface-container-high text-on-surface-variant py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-outline-variant/20">
                    <span className="material-symbols-outlined animate-bounce text-sm">edit</span>
                    <span className="font-label font-bold uppercase tracking-wider text-xs">Drawing...</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Footer Progress Section */}
      <footer className="fixed bottom-0 left-0 w-full z-50 flex flex-col justify-center items-center px-6 lg:px-16 py-6 lg:py-8 bg-[#ffffff]/95 backdrop-blur-md rounded-t-[3rem] border-t-2 border-[#e2dcd1] shadow-[0px_-20px_40px_rgba(49,46,41,0.08)]">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center w-full">
          <div className="flex justify-between items-end w-full max-w-3xl mb-3">
            <span className="font-label font-black text-primary text-sm uppercase tracking-widest px-4">{submittedCount} of {players.length} Finished</span>
            <span className="font-label font-bold text-outline-variant text-xs tracking-widest px-4">{percentage}%</span>
          </div>
          <div className="h-6 w-full max-w-3xl bg-surface-container-low rounded-full overflow-hidden p-1 border border-outline-variant/10 shadow-inner">
            <div className="h-full bg-primary rounded-full transition-all duration-1000 ease-out relative shadow-sm" style={{ width: `${percentage}%` }}>
              <div className="absolute inset-0 bg-white/20 skew-x-12 scale-110"></div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

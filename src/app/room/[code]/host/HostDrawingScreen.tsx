"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

const ROUND_DURATION_SECONDS = 60;

interface Props {
  code: string;
  roundId: string;
  /** ISO string from the server; null means the timer hasn't started yet */
  timerStartedAt: string | null;
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
export function HostDrawingScreen({ code, roundId, timerStartedAt: initialTimer }: Props) {
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

    // Refresh pending list when a pass advances
    const passCh = ably.channels.get(channels.roundPass(code));
    passCh.subscribe("pass-advanced", () => { fetchStatus(); });

    // Update disconnected list when a player's connection status changes
    const playersCh = ably.channels.get(channels.roomPlayers(code));
    playersCh.subscribe("player-connection-changed", () => { fetchStatus(); });

    // Subscribe to Ably presence leave/enter events and persist to DB
    playersCh.presence.subscribe((member) => {
      const data = member.data as { playerId?: string } | undefined;
      const pid = data?.playerId;
      if (!pid) return;
      const isConnected = member.action === "enter" || member.action === "present";
      fetch(`/api/players/${pid}/connection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isConnected }),
      }).catch(() => {/* non-fatal */});
    });

    return () => {
      cancelled = true;
      passCh.unsubscribe();
      playersCh.unsubscribe();
      playersCh.presence.unsubscribe();
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

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-lg py-8">
      {/* Countdown */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-gray-500 uppercase tracking-widest">Time Remaining</p>
        <div
          className={`text-8xl font-black tabular-nums transition-colors ${
            timerUrgent ? "text-red-600 animate-pulse" : "text-gray-900"
          }`}
          aria-label={`${secondsLeft} seconds remaining`}
          aria-live="polite"
        >
          {timerDone ? "Time's up!" : timeLabel}
        </div>
        <p className="text-sm text-gray-400">Pass {status.currentPass}</p>
      </div>

      {/* Pending players */}
      <div className="w-full">
        {status.pendingNicknames.length === 0 ? (
          <p className="text-center text-green-600 font-semibold text-lg">
            All drawings submitted!
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500 uppercase tracking-widest mb-3 text-center">
              Still drawing ({status.pendingNicknames.length})
            </p>
            <ul className="flex flex-wrap gap-2 justify-center">
              {status.pendingNicknames.map((name) => (
                <li
                  key={name}
                  className={`px-4 py-2 rounded-full font-medium text-sm border ${
                    status.disconnectedNicknames.includes(name)
                      ? "bg-gray-100 text-gray-400 border-gray-200 line-through"
                      : "bg-blue-50 text-blue-700 border-blue-200"
                  }`}
                >
                  {name}
                  {status.disconnectedNicknames.includes(name) && (
                    <span className="ml-1 text-xs text-gray-400">(offline)</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Disconnected players (those who already submitted but went offline) */}
      {status.disconnectedNicknames.length > 0 && (
        <div className="w-full text-center">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Disconnected</p>
          <p className="text-sm text-gray-500">
            {status.disconnectedNicknames.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}

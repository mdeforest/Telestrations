"use client";

import { useEffect, useState, useCallback } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { debugFetch } from "@/lib/debug/debug-fetch";
import { channels } from "@/lib/realtime/channels";
import { DrawingCanvas, type Stroke } from "@/components/DrawingCanvas";
import { PlayerWaitingScreen } from "./PlayerWaitingScreen";

const ROUND_DURATION_SECONDS = 60;

interface Props {
  code: string;
  roundId: string;
  playerId: string;
  /** ISO string from the server; null means the timer hasn't started yet */
  timerStartedAt: string | null;
  players: { id: string; nickname: string; seatOrder: number }[];
}

/**
 * Player phone view for the drawing phase.
 *
 * Shows:
 * - A countdown timer (cosmetic, derived from timerStartedAt)
 * - A placeholder canvas (the real canvas component will land with issue #7)
 * - A submit button
 * - A "Waiting for others" screen after submission
 */
export function DrawingPhaseScreen({ code, roundId, playerId, timerStartedAt, players }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number>(ROUND_DURATION_SECONDS);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // bookId, passNumber, and the word to draw are loaded from the my-entry endpoint
  const [entryInfo, setEntryInfo] = useState<{
    bookId: string;
    passNumber: number;
    wordToDraw: string | null;
  } | null>(null);

  // Countdown — recomputes every second from server-authoritative timerStartedAt
  useEffect(() => {
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
  }, [timerStartedAt]);

  // Load the player's own entry info (bookId + passNumber) for submission
  useEffect(() => {
    debugFetch(`/api/rounds/${roundId}/my-entry`)
      .then((r) => r.json())
      .then((data: { bookId?: string; passNumber?: number; alreadySubmitted?: boolean; incomingContent?: string | null }) => {
        if (data.alreadySubmitted) {
          setSubmitted(true);
        } else if (data.bookId && data.passNumber) {
          setEntryInfo({ bookId: data.bookId, passNumber: data.passNumber, wordToDraw: data.incomingContent ?? null });
        }
      })
      .catch(() => {/* non-fatal — submit button stays disabled */});
  }, [roundId]);

  // Subscribe to pass-advanced so we know when the round moves on
  useEffect(() => {
    const ably = getAblyClient();
    const ch = ably.channels.get(channels.roundPass(code));
    ch.subscribe("pass-advanced", () => {
      // Reload to pick up the new pass state from the server
      window.location.reload();
    });
    return () => ch.unsubscribe();
  }, [code]);

  // Enter Ably presence so the host screen can detect disconnects
  useEffect(() => {
    const ably = getAblyClient();
    const presenceCh = ably.channels.get(channels.roomPlayers(code));
    presenceCh.presence.enter({ playerId });
    return () => {
      presenceCh.presence.leave();
    };
  }, [code, playerId]);

  const handleSubmit = useCallback(async (strokes: Stroke[]) => {
    if (!entryInfo) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await debugFetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: entryInfo.bookId,
          passNumber: entryInfo.passNumber,
          type: "drawing",
          content: JSON.stringify(strokes),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to submit");
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }, [entryInfo]);

  // Format seconds as MM:SS
  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timerUrgent = secondsLeft <= 10;

  if (submitted) {
    return <PlayerWaitingScreen players={players} localPlayerId={playerId} phase="drawing" />;
  }

  return (
    <div className="flex flex-col flex-grow items-center w-full">
      {/* Top Navigation Shell (Suppressing full TopAppBar via relative overlap or positioning locally) */}
      <header className="flex justify-between items-center w-full px-4 sm:px-6 py-4 bg-surface z-30 border-b border-surface-variant">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="bg-surface-container-highest p-2 rounded-full hidden sm:block">
            <span className="material-symbols-outlined text-primary">brush</span>
          </div>
          <h1 className="font-headline font-extrabold tracking-tight text-lg sm:text-xl text-on-surface">
            Draw: <span className="text-primary italic">{entryInfo?.wordToDraw ?? "..."}</span>
          </h1>
        </div>

        {/* Timer: Heat-Up Element */}
        <div className={`px-4 sm:px-6 py-2 rounded-full flex items-center gap-2 border-2 transition-colors ${timerUrgent ? "bg-error-container text-on-error-container border-error sketch-shadow" : "bg-tertiary-container text-on-tertiary-container border-transparent sketch-shadow-tertiary"}`}>
          <span className="material-symbols-outlined font-bold">timer</span>
          <span className={`font-label font-bold text-xl sm:text-2xl tracking-widest ${timerUrgent ? "animate-pulse" : ""}`}>
            {String(minutes).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </span>
        </div>
      </header>

      {error && <p className="text-sm text-red-600 mt-2 bg-error-container px-4 py-2 rounded-md font-bold">{error}</p>}

      <DrawingCanvas
        onSubmit={handleSubmit}
        disabled={submitting || !entryInfo}
      />
    </div>
  );
}

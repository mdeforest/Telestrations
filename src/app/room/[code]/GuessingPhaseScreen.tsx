"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { debugFetch } from "@/lib/debug/debug-fetch";
import { channels } from "@/lib/realtime/channels";
import { DrawingCanvas, type Stroke } from "@/components/DrawingCanvas";
import { GuessingWaitingScreen } from "./GuessingWaitingScreen";

const ROUND_DURATION_SECONDS = 60;

interface Props {
  code: string;
  roundId: string;
  playerId: string;
  timerStartedAt: string | null;
  /** JSON-serialized Stroke[] from the previous pass. Null if unavailable. */
  incomingDrawing: string | null;
  players: { id: string; nickname: string; seatOrder: number }[];
}

/**
 * Player phone view for the guessing phase.
 *
 * Shows:
 * - A read-only canvas replay of the incoming drawing
 * - A text input for the guess
 * - A countdown timer
 * - A "Waiting for others" screen after submission
 */
export function GuessingPhaseScreen({
  code,
  roundId,
  playerId,
  timerStartedAt,
  incomingDrawing,
  players,
}: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number>(ROUND_DURATION_SECONDS);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState("");
  const [entryInfo, setEntryInfo] = useState<{
    bookId: string;
    passNumber: number;
  } | null>(null);

  // Parse incoming drawing strokes — memoized so DrawingCanvas's useEffect
  // doesn't re-fire on every render due to a new array reference.
  const replayStrokes = useMemo<Stroke[]>(() => {
    if (!incomingDrawing) return [];
    try { return JSON.parse(incomingDrawing) as Stroke[]; } catch { return []; }
  }, [incomingDrawing]);

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

  // Load entry info (bookId + passNumber) for submission
  useEffect(() => {
    debugFetch(`/api/rounds/${roundId}/my-entry`)
      .then((r) => r.json())
      .then((data: { bookId?: string; passNumber?: number; alreadySubmitted?: boolean }) => {
        if (data.alreadySubmitted) {
          setSubmitted(true);
        } else if (data.bookId && data.passNumber) {
          setEntryInfo({ bookId: data.bookId, passNumber: data.passNumber });
        }
      })
      .catch(() => {/* non-fatal */});
  }, [roundId]);

  // Subscribe to pass-advanced / room-status-changed to reload when round moves
  useEffect(() => {
    const ably = getAblyClient();
    const ch = ably.channels.get(channels.roundPass(code));
    ch.subscribe("pass-advanced", () => {
      window.location.reload();
    });
    return () => ch.unsubscribe();
  }, [code]);

  // Enter Ably presence
  useEffect(() => {
    const ably = getAblyClient();
    const presenceCh = ably.channels.get(channels.roomPlayers(code));
    presenceCh.presence.enter({ playerId });
    return () => {
      presenceCh.presence.leave();
    };
  }, [code, playerId]);


  const handleSubmit = useCallback(async () => {
    if (!entryInfo || !guess.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await debugFetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: entryInfo.bookId,
          passNumber: entryInfo.passNumber,
          type: "guess",
          content: guess.trim(),
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
  }, [entryInfo, guess]);

  const minutes = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeLabel = `${minutes}:${String(secs).padStart(2, "0")}`;
  const timerUrgent = secondsLeft <= 10;

  if (submitted) {
    return <GuessingWaitingScreen players={players} localPlayerId={playerId} />;
  }

  return (
    <main className="flex-grow flex flex-col items-center px-4 pt-8 pb-24 max-w-2xl mx-auto w-full gap-8">
      {/* Header Instruction */}
      <div className="text-center space-y-2">
        <h2 className="font-headline font-extrabold text-3xl md:text-4xl text-primary tracking-tight">What is this drawing?</h2>
        <p className="font-body text-on-surface-variant font-semibold">
          Previous player: <span className="text-secondary">@Unknown</span>
        </p>
      </div>

      {/* Timer Element */}
      <div className={`flex items-center gap-3 px-6 py-2 rounded-full wonky-input border-2 transition-colors ${timerUrgent ? "bg-error-container text-on-error-container border-error shadow-[2px_2px_0px_#9f0519]" : "bg-tertiary-container text-on-tertiary-container border-transparent shadow-[2px_2px_0px_#594a00]"}`}>
        <span className="material-symbols-outlined">timer</span>
        <span className={`font-label font-bold text-xl tracking-widest ${timerUrgent ? "animate-pulse" : ""}`}>
          {timeLabel}
        </span>
      </div>

      {/* Incoming drawing — read-only canvas via DrawingCanvas replay */}
      <DrawingCanvas
        onSubmit={() => undefined}
        replayStrokes={replayStrokes}
        readOnly
      />

      {error && <p className="text-sm text-red-600 font-bold bg-error-container px-4 py-2 rounded-lg">{error}</p>}

      {/* Input Section */}
      <div className="w-full max-w-md space-y-6">
        <div className="relative group">
          <input
            autoFocus
            type="text"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            placeholder="Type your guess..."
            maxLength={200}
            disabled={submitting}
            className="w-full bg-surface-container-lowest border-none ring-2 ring-outline-variant/15 focus:ring-primary/40 rounded-xl py-5 px-6 text-xl font-headline font-bold text-on-surface placeholder:text-outline-variant/60 focus:outline-none transition-all wonky-input shadow-sm disabled:opacity-50"
            aria-label="Your guess"
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-outline-variant/30 hidden md:block">
            <span className="font-label text-xs uppercase tracking-tighter">Press Enter</span>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !entryInfo || !guess.trim()}
          className="w-full bg-primary text-on-primary font-headline font-extrabold text-xl py-5 rounded-xl sketch-shadow transition-all hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#962700] active:scale-[0.98] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:grayscale"
        >
          {submitting ? "Submitting..." : "Submit Guess"}
        </button>
      </div>
    </main>
  );
}

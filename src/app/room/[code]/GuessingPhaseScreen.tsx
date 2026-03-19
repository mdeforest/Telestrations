"use client";

import { useEffect, useState, useCallback } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";
import { DrawingCanvas, type Stroke } from "@/components/DrawingCanvas";

const ROUND_DURATION_SECONDS = 60;

interface Props {
  code: string;
  roundId: string;
  playerId: string;
  timerStartedAt: string | null;
  /** JSON-serialized Stroke[] from the previous pass. Null if unavailable. */
  incomingDrawing: string | null;
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

  // Parse incoming drawing strokes once so DrawingCanvas can replay them
  const replayStrokes: Stroke[] = (() => {
    if (!incomingDrawing) return [];
    try { return JSON.parse(incomingDrawing) as Stroke[]; } catch { return []; }
  })();

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
    fetch(`/api/rounds/${roundId}/my-entry`)
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
      const res = await fetch("/api/entries", {
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
    return (
      <div className="flex flex-col items-center gap-6 py-12">
        <div className="text-5xl">🤔</div>
        <h2 className="text-2xl font-bold">Waiting for others…</h2>
        <p className="text-gray-500 text-center max-w-xs">
          Your guess is in! Hang tight while the rest of the table finishes.
        </p>
        <div className="flex gap-1 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm">
      {/* Countdown */}
      <div
        className={`text-5xl font-black tabular-nums transition-colors ${
          timerUrgent ? "text-red-600" : "text-gray-900"
        }`}
        aria-label={`${secondsLeft} seconds remaining`}
        aria-live="polite"
      >
        {timeLabel}
      </div>

      {/* Incoming drawing — read-only canvas via DrawingCanvas replay */}
      <DrawingCanvas
        onSubmit={() => {/* read-only; no submit */}}
        replayStrokes={replayStrokes}
        disabled
      />

      <p className="text-sm text-gray-500 font-medium uppercase tracking-widest">
        What is this drawing?
      </p>

      {/* Guess input */}
      <input
        type="text"
        value={guess}
        onChange={(e) => setGuess(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        placeholder="Type your best guess…"
        maxLength={200}
        disabled={submitting}
        className="w-full rounded-xl border px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        aria-label="Your guess"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || !entryInfo || !guess.trim()}
        className="w-full py-3 rounded-xl text-lg font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
      >
        {submitting ? "Submitting…" : "Submit Guess"}
      </button>
    </div>
  );
}

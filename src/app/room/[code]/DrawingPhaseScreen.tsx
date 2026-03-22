"use client";

import { useEffect, useState, useCallback } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { debugFetch } from "@/lib/debug/debug-fetch";
import { channels } from "@/lib/realtime/channels";
import { DrawingCanvas, type Stroke } from "@/components/DrawingCanvas";

const ROUND_DURATION_SECONDS = 60;

interface Props {
  code: string;
  roundId: string;
  playerId: string;
  /** ISO string from the server; null means the timer hasn't started yet */
  timerStartedAt: string | null;
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
export function DrawingPhaseScreen({ code, roundId, playerId, timerStartedAt }: Props) {
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
  const timeLabel = `${minutes}:${String(secs).padStart(2, "0")}`;
  const timerUrgent = secondsLeft <= 10;

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-6 py-12">
        <div className="text-5xl">✏️</div>
        <h2 className="text-2xl font-bold">Waiting for others…</h2>
        <p className="text-gray-500 text-center max-w-xs">
          Your drawing is in! Hang tight while the rest of the table finishes.
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

      {entryInfo?.wordToDraw && (
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Draw this</p>
          <p className="text-2xl font-bold text-gray-900">{entryInfo.wordToDraw}</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <DrawingCanvas
        onSubmit={handleSubmit}
        disabled={submitting || !entryInfo}
      />
    </div>
  );
}

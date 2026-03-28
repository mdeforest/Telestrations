"use client";

import { useEffect, useMemo, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { debugFetch } from "@/lib/debug/debug-fetch";
import { channels } from "@/lib/realtime/channels";
import { DrawingCanvas, type Stroke } from "@/components/DrawingCanvas";

interface Entry {
  id: string;
  passNumber: number;
  type: "drawing" | "guess";
  content: string;
  authorPlayerId: string;
  authorNickname: string;
}

interface Book {
  id: string;
  originalPrompt: string;
  ownerPlayerId: string;
  ownerNickname: string;
  roundNumber: number;
  entries: Entry[];
}

interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  totalPoints: number | string | null;
}

interface Props {
  code: string;
  playerId: string;
  scoringMode: "friendly" | "competitive";
  isHost?: boolean;
  initialBookIndex: number;
  initialEntryIndex: number;
}

export function PlayerRevealScreen({
  code,
  playerId,
  scoringMode,
  isHost = false,
  initialBookIndex,
  initialEntryIndex,
}: Props) {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookIndex, setBookIndex] = useState(initialBookIndex);
  const [entryIndex, setEntryIndex] = useState(initialEntryIndex);
  const [finished, setFinished] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Leaderboard (competitive mode after scoring:complete)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);

  // Fetch all book+entry data on mount
  useEffect(() => {
    debugFetch(`/api/rooms/${code}/reveal/books`)
      .then((r) => r.json())
      .then((data: { books: Book[]; revealBookIndex: number; revealEntryIndex: number; status: string }) => {
        setBooks(data.books);
        if (typeof data.revealBookIndex === "number") setBookIndex(data.revealBookIndex);
        if (typeof data.revealEntryIndex === "number") setEntryIndex(data.revealEntryIndex);
        if (data.status === "finished") setFinished(true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [code]);

  // Subscribe to reveal:advance Ably events
  useEffect(() => {
    const ably = getAblyClient();
    const ch = ably.channels.get(channels.revealAdvance(code));
    ch.subscribe("reveal:advance", (msg) => {
      const { revealBookIndex, revealEntryIndex, finished: done } = msg.data as {
        revealBookIndex: number;
        revealEntryIndex: number;
        finished: boolean;
      };
      setBookIndex(revealBookIndex);
      setEntryIndex(revealEntryIndex);
      if (done) setFinished(true);
    });
    return () => ch.unsubscribe();
  }, [code]);

  // Subscribe to scoring:complete for leaderboard
  useEffect(() => {
    const ably = getAblyClient();
    const ch = ably.channels.get(channels.scoringComplete(code));
    ch.subscribe("scoring:complete", (msg) => {
      const { leaderboard: lb } = msg.data as { leaderboard: LeaderboardEntry[] };
      setLeaderboard(lb);
    });
    return () => ch.unsubscribe();
  }, [code]);

  const currentBook = books[bookIndex];
  const currentEntry = currentBook?.entries[entryIndex];

  const isMyBook = currentBook?.ownerPlayerId === playerId;
  const isMyEntry = currentEntry?.authorPlayerId === playerId;

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await debugFetch(`/api/rooms/${code}/reveal/advance`, { method: "POST" });
    } finally {
      setAdvancing(false);
    }
  }

  const replayStrokes = useMemo<Stroke[]>(() => {
    if (!currentEntry || currentEntry.type !== "drawing") return [];
    try { return JSON.parse(currentEntry.content) as Stroke[]; } catch { return []; }
  }, [currentEntry]);

  if (loading) {
    return (
      <main className="flex-1 px-6 pt-12 max-w-lg mx-auto w-full flex flex-col items-center justify-center h-full">
        <div className="w-20 h-20 bg-surface-container-high rounded-full flex items-center justify-center border-4 border-dashed border-outline-variant/30 animate-spin" style={{ animationDuration: "3s" }}>
          <span className="material-symbols-outlined text-outline-variant text-4xl animate-pulse">refresh</span>
        </div>
        <p className="font-label text-sm uppercase tracking-widest text-on-surface-variant mt-6 font-bold">Loading reveal...</p>
      </main>
    );
  }

  // Leaderboard screen (after host tallies)
  if (leaderboard) {
    return (
      <main className="flex-1 px-6 pt-12 pb-32 max-w-lg mx-auto w-full space-y-8">
        <section className="text-center space-y-4 transform -rotate-1">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-tertiary-container rounded-full sketch-shadow mb-2 border-2 border-tertiary/20">
            <span className="text-5xl">🏆</span>
          </div>
          <h2 className="font-headline font-extrabold text-4xl text-on-surface tracking-tight">Final Standings</h2>
        </section>
        
        <div className="bg-surface-container-lowest rounded-xl p-6 sketch-shadow border-outline-variant/10 border transform rotate-1 space-y-3">
          {leaderboard.map((entry, i) => {
            const isMe = entry.playerId === playerId;
            return (
              <div
                key={entry.playerId}
                className={`flex items-center gap-4 px-4 py-3 rounded-lg border-2 transition-colors ${
                  isMe
                    ? "border-primary bg-primary-container"
                    : "border-outline-variant/10 bg-surface-container-high"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-xl font-bold">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="font-label text-outline-variant text-sm">{i + 1}</span>}
                </div>
                <span className={`flex-1 font-headline font-bold text-lg ${isMe ? "text-on-primary-container" : "text-on-surface"}`}>
                  {entry.nickname} {isMe && "(You)"}
                </span>
                <div className="bg-surface-container-lowest px-3 py-1 rounded shadow-inner border border-outline-variant/10">
                  <span className="font-label font-black text-tertiary">{entry.totalPoints ?? 0} pts</span>
                </div>
              </div>
            );
          })}
          {leaderboard.length === 0 && (
            <p className="font-body text-center text-on-surface-variant font-medium py-8">No points were scored.</p>
          )}
        </div>
      </main>
    );
  }

  // After reveal ends — friendly mode: simple wrap screen
  if (finished && scoringMode === "friendly") {
    return (
      <main className="flex-1 px-6 pt-12 pb-32 max-w-lg mx-auto w-full flex flex-col items-center justify-center gap-6 text-center">
        <div className="w-24 h-24 rounded-full flex items-center justify-center bg-tertiary-container border-4 border-tertiary sketch-shadow-tertiary mx-auto">
          <span className="text-4xl">🎉</span>
        </div>
        <h2 className="font-headline text-4xl font-extrabold text-on-surface">That&apos;s a Wrap!</h2>
        <p className="text-on-surface-variant font-medium text-lg">Hope you had a blast!</p>
      </main>
    );
  }

  if (finished || !currentBook || !currentEntry) {
    return (
      <main className="flex-1 px-6 pt-12 pb-32 max-w-lg mx-auto w-full space-y-8 text-center">
        <div className="inline-flex items-center justify-center w-24 h-24 bg-surface-container-highest rounded-full sketch-shadow transform -rotate-2 mb-4">
          <span className="text-6xl">🎊</span>
        </div>
        <h2 className="font-headline font-extrabold text-4xl text-on-surface tracking-tight">Game Over!</h2>
        <p className="font-body text-on-surface-variant font-medium">Thanks for playing!</p>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-6 pt-8 pb-32 space-y-8 w-full">
      {/* Header Info */}
      <section className="text-center space-y-2">
        <span className="font-label text-sm uppercase tracking-widest text-secondary font-bold">
          {scoringMode === "friendly" ? "No Scoring" : "Competitive"}
        </span>
        <h2 className="font-headline text-3xl font-extrabold text-on-surface">The Grand Reveal!</h2>
        <p className="text-on-surface-variant font-body font-medium">
          {isHost ? "Host controls the pace below." : "Watch the masterpiece unfold."}
        </p>
      </section>

      {/* Current Reveal Card */}
      <section className="relative bg-surface-container-lowest rounded-xl p-6 sketch-shadow-primary border-outline-variant/10 border transform -rotate-1 z-10 w-full">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-on-secondary-container font-label ${isMyBook ? "bg-primary-container text-on-primary-container" : "bg-secondary-container"}`}>
              {isMyBook ? "ME" : currentBook.ownerNickname.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-label font-bold text-[10px] leading-none text-secondary opacity-70">
                {isMyBook ? "YOUR BOOK" : "ARTIST'S BOOK"}
              </p>
              <p className="font-headline font-bold text-on-surface truncate max-w-[120px]">
                {isMyBook ? "You" : currentBook.ownerNickname}
              </p>
            </div>
          </div>
          <div className="bg-tertiary-container px-3 py-1.5 rounded-full text-on-tertiary-container font-label text-[10px] font-black uppercase tracking-widest shadow-inner border border-tertiary/20">
            &ldquo;{currentBook.originalPrompt}&rdquo;
          </div>
        </div>

        {/* Entry Canvas / Guess Area */}
        <div className="aspect-square bg-surface-container-low rounded-xl mb-6 flex flex-col items-center justify-center overflow-hidden border-2 border-dashed border-outline-variant/30">
          {isMyEntry && (
            <div className="w-full bg-primary py-1 px-4 text-center">
              <span className="font-label text-[10px] font-bold text-on-primary uppercase tracking-widest">
                ⭐ You made this!
              </span>
            </div>
          )}

          <div className="w-full flex-1 flex flex-col items-center justify-center p-4">
            <p className="font-label text-[10px] text-outline-variant uppercase tracking-widest font-bold mb-3 text-center w-full">
              {currentEntry.authorNickname} {currentEntry.type === "drawing" ? "drew" : "guessed"}
            </p>

            {currentEntry.type === "drawing" ? (
              <div className="w-full flex-1 max-w-full">
                <DrawingCanvas
                  onSubmit={() => undefined}
                  replayStrokes={replayStrokes}
                  readOnly
                />
              </div>
            ) : (
              <p className="font-headline text-3xl font-extrabold text-on-surface text-center px-4 italic leading-tight">
                &ldquo;{currentEntry.content}&rdquo;
              </p>
            )}
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="flex items-center justify-between font-label text-[10px] uppercase font-bold text-outline-variant px-2 bg-surface-container-low rounded-full py-2 shadow-inner">
          <span>Book {bookIndex + 1}/{books.length}</span>
          <div className="flex gap-1.5">
            {currentBook.entries.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === entryIndex ? "bg-primary" : i < entryIndex ? "bg-outline-variant" : "bg-outline-variant/30"
                }`}
              />
            ))}
          </div>
          <span>Entry {entryIndex + 1}/{currentBook.entries.length}</span>
        </div>
      </section>

      {/* Host Controls */}
      {isHost ? (
        <section className="mt-8 transform rotate-1">
          <button
            onClick={handleAdvance}
            disabled={advancing}
            className="w-full bg-primary text-on-primary font-headline font-extrabold text-xl py-5 rounded-xl sketch-shadow transition-all hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_0px_#962700] active:scale-[0.98] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3"
          >
            {advancing ? (
              <>
                <span className="material-symbols-outlined animate-spin text-2xl">autorenew</span>
                <span>Loading...</span>
              </>
            ) : entryIndex + 1 < (currentBook?.entries.length ?? 0) ? (
              <>
                <span>Next Entry</span>
                <span className="material-symbols-outlined font-bold text-xl">arrow_forward</span>
              </>
            ) : bookIndex + 1 < books.length ? (
              <>
                <span>Next Book</span>
                <span className="material-symbols-outlined font-bold text-xl">library_books</span>
              </>
            ) : (
              <>
                <span>Finish Reveal</span>
                <span className="material-symbols-outlined font-bold text-xl">flag</span>
              </>
            )}
          </button>
        </section>
      ) : (
        <section className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/20 shadow-sm text-center font-label text-xs uppercase font-bold text-outline-variant border-dashed">
          Waiting for host to continue...
        </section>
      )}

    </main>
  );
}

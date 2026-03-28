"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  scoringMode: "friendly" | "competitive";
  initialBookIndex: number;
  initialEntryIndex: number;
}

/** Single entry in the timeline strip at footer */
function TimelineStep({
  type,
  isActive,
  isFuture,
  author,
}: {
  content: string;
  type: "prompt" | "drawing" | "guess";
  isActive: boolean;
  isFuture: boolean;
  author: string;
}) {
  const icon = type === "prompt" ? "edit_note" : type === "drawing" ? "brush" : "lightbulb";
  const colorClass = isActive
    ? "bg-primary text-on-primary border-primary sketch-shadow-primary scale-105"
    : isFuture
    ? "bg-surface-container-high border-outline-variant/20 text-outline-variant opacity-40"
    : "bg-surface-container-lowest border-outline-variant/30 text-on-surface";

  return (
    <div className={`flex flex-col items-center gap-1 transition-all duration-500 shrink-0`}>
      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${colorClass}`}>
        <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      </div>
      <span className="text-[9px] font-label uppercase tracking-widest text-outline-variant font-bold max-w-[56px] text-center truncate" title={author}>{author}</span>
    </div>
  );
}

function TimelineConnector({ isFuture }: { isFuture: boolean }) {
  return (
    <div className={`h-0.5 w-8 md:w-14 shrink-0 rounded-full transition-all duration-500 ${isFuture ? "bg-outline-variant/20" : "bg-primary/40"}`} />
  );
}

export function HostRevealScreen({ code, scoringMode, initialBookIndex, initialEntryIndex }: Props) {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookIndex, setBookIndex] = useState(initialBookIndex);
  const [entryIndex, setEntryIndex] = useState(initialEntryIndex);
  const [finished, setFinished] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tallying, setTallying] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);

  // Fetch all book+entry data on mount
  useEffect(() => {
    debugFetch(`/api/rooms/${code}/reveal/books`)
      .then((r) => r.json())
      .then((data: { books?: Book[]; revealBookIndex?: number; revealEntryIndex?: number; status?: string }) => {
        setBooks(data.books ?? []);
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

  // Subscribe to scoring:complete to update leaderboard if tallied elsewhere
  useEffect(() => {
    const ably = getAblyClient();
    const ch = ably.channels.get(channels.scoringComplete(code));
    ch.subscribe("scoring:complete", (msg) => {
      const { leaderboard: lb } = msg.data as { leaderboard: LeaderboardEntry[] };
      setLeaderboard(lb);
    });
    return () => ch.unsubscribe();
  }, [code]);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await debugFetch(`/api/rooms/${code}/reveal/advance`, { method: "POST" });
    } finally {
      setAdvancing(false);
    }
  }

  async function handleTally() {
    if (tallying) return;
    setTallying(true);
    try {
      const res = await debugFetch(`/api/rooms/${code}/tally`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data.leaderboard);
      }
    } finally {
      setTallying(false);
    }
  }

  const currentBook = books[bookIndex];
  const currentEntry = currentBook?.entries[entryIndex];

  const replayStrokes = useMemo<Stroke[]>(() => {
    if (!currentEntry || currentEntry.type !== "drawing") return [];
    try { return JSON.parse(currentEntry.content) as Stroke[]; } catch { return []; }
  }, [currentEntry]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface paper-texture">
        <div className="text-center">
          <span className="material-symbols-outlined text-6xl text-primary animate-bounce block mb-4">auto_stories</span>
          <p className="text-on-surface-variant text-lg font-medium font-body">Loading the big reveal...</p>
        </div>
      </div>
    );
  }

  // Leaderboard screen
  if (leaderboard && scoringMode === "competitive") {
    const medals = ["🥇", "🥈", "🥉"];
    return (
      <div className="min-h-screen bg-surface paper-texture flex flex-col items-center justify-center px-8 py-16 gap-10">
        <div className="text-center">
          <p className="font-label text-sm uppercase tracking-widest text-tertiary mb-3 font-bold">Game Over</p>
          <h1 className="font-headline text-6xl font-black text-on-surface mb-2">Leaderboard</h1>
          <p className="text-on-surface-variant font-medium">Thanks for playing! Here&apos;s how everyone did:</p>
        </div>
        <div className="w-full max-w-lg flex flex-col gap-4">
          {leaderboard.map((entry, i) => (
            <div
              key={entry.playerId}
              className={`flex items-center gap-5 px-6 py-5 rounded-2xl border-2 transition-transform hover:scale-[1.02] ${
                i === 0
                  ? "bg-tertiary-container border-tertiary sketch-shadow-tertiary"
                  : i === 1
                  ? "bg-secondary-container/40 border-secondary/30 sketch-shadow-secondary"
                  : "bg-surface-container-lowest border-outline-variant/30 shadow-sm"
              }`}
              style={{ transform: i % 2 === 0 ? "rotate(-0.5deg)" : "rotate(0.5deg)" }}
            >
              <span className="text-3xl font-black w-10 text-center">{medals[i] ?? i + 1}</span>
              <span className="flex-1 font-headline text-xl font-extrabold text-on-surface">{entry.nickname}</span>
              <div className="bg-surface-container-lowest px-4 py-2 rounded-xl border border-outline-variant/20 font-label font-bold text-lg text-secondary">
                {entry.totalPoints ?? 0} pts
              </div>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <p className="text-center text-on-surface-variant font-medium py-8">No votes were cast.</p>
          )}
        </div>
      </div>
    );
  }

  // Books not yet populated (API returned empty or hasn't updated yet) — show a brief wait
  if (!currentBook || !currentEntry) {
    if (finished) {
      // Fall through to the finished screen below
    } else {
      return (
        <div className="flex items-center justify-center min-h-screen bg-surface paper-texture">
          <div className="text-center">
            <span className="material-symbols-outlined text-6xl text-primary animate-bounce block mb-4">auto_stories</span>
            <p className="text-on-surface-variant text-lg font-medium font-body">Preparing the reveal...</p>
          </div>
        </div>
      );
    }
  }

  // Game finished
  if (finished) {
    // No Scoring mode: just show a wrap screen, no tally
    if (scoringMode === "friendly") {
      return (
        <div className="min-h-screen bg-surface paper-texture flex flex-col items-center justify-center gap-8 px-8 py-16">
          <div className="text-center">
            <div className="w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-6 border-4 bg-tertiary-container border-tertiary sketch-shadow-tertiary">
              <span className="text-5xl">🎉</span>
            </div>
            <h1 className="font-headline text-5xl font-black text-on-surface mb-3">
              That&apos;s a Wrap!
            </h1>
            <p className="text-on-surface-variant text-lg font-medium">
              Thanks for playing! Hope everyone had a great time.
            </p>
          </div>
        </div>
      );
    }

    // Competitive mode: show tally button → leaderboard
    return (
      <div className="min-h-screen bg-surface paper-texture flex flex-col items-center justify-center gap-8 px-8 py-16">
        <div className="text-center">
          <div className="w-28 h-28 rounded-full flex items-center justify-center mx-auto mb-6 border-4 bg-primary-container border-primary sketch-shadow-primary">
            <span className="text-5xl">🏁</span>
          </div>
          <h1 className="font-headline text-5xl font-black text-on-surface mb-3">
            Game Over!
          </h1>
          <p className="text-on-surface-variant text-lg font-medium">
            Calculate the final scores and show the leaderboard.
          </p>
        </div>
        <button
          onClick={handleTally}
          disabled={tallying}
          className={`rounded-full px-12 py-5 font-headline font-bold text-xl flex items-center gap-3 transition-all ${
            !tallying
              ? "bg-primary text-on-primary hover:-translate-y-1 hover:shadow-xl active:scale-95 sketch-shadow-primary"
              : "bg-surface-container-high text-outline-variant cursor-not-allowed opacity-70"
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
            {tallying ? "hourglass_empty" : "workspace_premium"}
          </span>
          {tallying ? "Tallying..." : "Show Final Scores"}
        </button>
      </div>
    );
  }

  const totalBooks = books.length;
  const totalEntries = currentBook.entries.length;
  const isLastEntry = entryIndex + 1 >= totalEntries;
  const isLastBook = bookIndex + 1 >= totalBooks;

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen flex flex-col selection:bg-tertiary-container w-full" style={{ backgroundImage: "radial-gradient(#e2dcd1 1px, transparent 1px)", backgroundSize: "32px 32px" }}>
      {/* TopAppBar */}
      <header className="bg-[#fcf6ed]/95 backdrop-blur-md px-8 py-5 lg:px-12 z-40 border-b-2 border-outline-variant/10 shadow-sm">
        <div className="flex justify-between items-center w-full max-w-full">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-black text-primary font-headline truncate max-w-[180px] md:max-w-none">The Animated Sketchpad</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <h1 className="font-headline text-xl font-bold text-primary">The Grand Reveal!</h1>
            <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              Reviewing: <span className="text-secondary font-black">{currentBook.ownerNickname.toUpperCase()}&apos;S BOOK</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-secondary-container text-secondary font-label font-bold px-4 py-1.5 rounded-lg tracking-widest text-sm border border-secondary/20">
              Book {bookIndex + 1}/{totalBooks}
            </div>
          </div>
        </div>
        <div className="bg-outline-variant/30 h-0.5 mt-4 rounded-full w-full">
          <div className="bg-primary h-full rounded-full transition-all duration-700" style={{ width: `${((bookIndex * totalEntries + entryIndex + 1) / (totalBooks * totalEntries)) * 100}%` }}></div>
        </div>
      </header>

      {/* Main Cinematic Canvas */}
      <main className="flex-grow flex flex-col items-center justify-center p-6 lg:p-8 pb-36 overflow-hidden relative">
        {/* Decorative background icons */}
        <div className="absolute top-1/4 left-10 opacity-10 hidden lg:block pointer-events-none">
          <span className="material-symbols-outlined text-[8rem] text-primary">draw</span>
        </div>
        <div className="absolute bottom-1/4 right-10 opacity-10 hidden lg:block pointer-events-none">
          <span className="material-symbols-outlined text-[8rem] text-secondary">palette</span>
        </div>

        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-[1fr_auto_2fr_auto_1fr] gap-4 md:gap-6 items-center relative z-10">
          {/* Left: Original Prompt */}
          <div className="flex flex-col items-center gap-4" style={{ transform: "rotate(-1deg)" }}>
            <div className="font-label text-xs font-bold bg-surface-container-high px-4 py-1 rounded-full text-on-surface-variant uppercase tracking-widest">Starting Word</div>
            <div className="bg-surface-container-lowest p-8 rounded-lg sketch-shadow-secondary border-2 border-outline-variant/10 w-full text-center shadow-sm">
              <h2 className="font-headline text-2xl lg:text-3xl font-extrabold text-secondary leading-tight">&ldquo;{currentBook.originalPrompt}&rdquo;</h2>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="material-symbols-outlined text-secondary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>person</span>
              <span className="font-body font-bold text-on-surface">{currentBook.ownerNickname}</span>
            </div>
          </div>

          {/* Connector */}
          <div className="hidden md:flex justify-center text-outline-variant/40">
            <span className="material-symbols-outlined text-5xl">trending_flat</span>
          </div>

          {/* Center: Current Entry (Sketch or Guess) — Main Focal Point */}
          <div className="relative col-span-1" style={{ transform: "rotate(1.5deg)" }}>
            {currentEntry.type === "drawing" ? (
              <>
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 font-label text-xs font-bold bg-primary px-6 py-2 rounded-full text-on-primary z-10 sketch-shadow-primary uppercase tracking-wider whitespace-nowrap">
                  Sketch Reveal
                </div>
                <div className="bg-surface-container-lowest p-3 md:p-4 rounded-xl sketch-shadow-primary border-4 border-primary/20 overflow-hidden aspect-square">
                  <DrawingCanvas
                    onSubmit={() => undefined}
                    replayStrokes={replayStrokes}
                    readOnly
                  />
                </div>
              </>
            ) : (
              <>
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 font-label text-xs font-bold bg-secondary px-6 py-2 rounded-full text-on-secondary z-10 sketch-shadow-secondary uppercase tracking-wider whitespace-nowrap">
                  The Guess
                </div>
                <div className="bg-surface-container-lowest p-8 rounded-lg border-4 border-dashed border-outline-variant w-full text-center relative min-h-[180px] flex items-center justify-center shadow-sm">
                  <h2 className="font-headline text-3xl lg:text-4xl font-bold text-on-surface italic leading-snug">&ldquo;{currentEntry.content}&rdquo;</h2>
                  <div className="absolute -top-3 -right-3 bg-error-container text-on-error-container p-1.5 rounded-full rotate-12 shadow-sm">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-center gap-2 mt-5">
              <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>{currentEntry.type === "drawing" ? "brush" : "lightbulb"}</span>
              <span className="font-body font-bold text-on-surface text-base">{currentEntry.authorNickname}&apos;s {currentEntry.type === "drawing" ? "Masterpiece" : "Guess"}</span>
            </div>
          </div>

          {/* Connector */}
          <div className="hidden md:flex justify-center text-outline-variant/40">
            <span className="material-symbols-outlined text-5xl">trending_flat</span>
          </div>

          {/* Right: Next entry preview (blurred/dimmed if future) */}
          {(() => {
            const nextEntry = currentBook.entries[entryIndex + 1];
            if (!nextEntry) {
              return (
                <div className="flex flex-col items-center gap-4 opacity-30" style={{ transform: "rotate(-0.5deg)" }}>
                  <div className="font-label text-xs font-bold bg-surface-container-high px-4 py-1 rounded-full text-on-surface-variant uppercase tracking-widest">{isLastBook ? "The End" : "Next Book"}</div>
                  <div className="bg-surface-container-lowest p-8 rounded-lg border-2 border-dashed border-outline-variant w-full text-center min-h-[100px] flex items-center justify-center">
                    <span className="material-symbols-outlined text-4xl text-outline-variant">{isLastBook ? "flag" : "auto_stories"}</span>
                  </div>
                </div>
              );
            }
            return (
              <div className="flex flex-col items-center gap-4 blur-[6px] opacity-50" style={{ transform: "rotate(-0.5deg)", pointerEvents: "none" }}>
                <div className="font-label text-xs font-bold bg-surface-container-high px-4 py-1 rounded-full text-on-surface-variant uppercase tracking-widest">
                  {nextEntry.type === "drawing" ? "Sketch" : "Guess"}
                </div>
                <div className="bg-surface-container-lowest p-8 rounded-lg border-2 border-outline-variant/10 w-full text-center">
                  <p className="font-headline text-xl font-bold text-on-surface">{nextEntry.type === "drawing" ? "??" : `"..."`}</p>
                </div>
              </div>
            );
          })()}
        </div>
      </main>

      {/* Footer: Navigation & Chain Timeline */}
      <footer className="bg-[#ffffff]/95 backdrop-blur-md fixed bottom-0 left-0 w-full z-50 flex flex-col px-6 lg:px-16 py-5 rounded-t-[3rem] border-t-2 border-[#e2dcd1] shadow-[0px_-20px_40px_rgba(49,46,41,0.08)]">
        {/* Chain timeline strip */}
        <div className="flex items-center gap-1 justify-center mb-5 overflow-x-auto pb-1">
          {/* Prompt is step 0 */}
          <TimelineStep
            content={currentBook.originalPrompt}
            type="prompt"
            isActive={false}
            isFuture={false}
            author={currentBook.ownerNickname}
          />
          {currentBook.entries.map((entry, i) => (
            <Fragment key={entry.id}>
              <TimelineConnector isFuture={i > entryIndex} />
              <TimelineStep
                content={entry.type === "drawing" ? "(sketch)" : entry.content}
                type={entry.type}
                isActive={i === entryIndex}
                isFuture={i > entryIndex}
                author={entry.authorNickname}
              />
            </Fragment>
          ))}
        </div>

        {/* Nav buttons */}
        <div className="flex justify-between items-center">
          <div className="font-label text-sm uppercase tracking-widest text-on-surface-variant">
            <span className="font-black text-secondary">Entry {entryIndex + 1}</span> of {totalEntries}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleAdvance}
              disabled={advancing}
              className={`rounded-full px-8 py-3 font-label font-bold uppercase tracking-widest text-sm flex items-center gap-2 transition-all ${
                !advancing
                  ? "bg-primary text-on-primary hover:rotate-1 hover:scale-105 active:scale-95 sketch-shadow-primary"
                  : "bg-surface-container-high text-outline-variant cursor-not-allowed opacity-70"
              }`}
            >
              <span>{advancing ? "..." : isLastEntry && isLastBook ? "Finish" : isLastEntry ? "Next Book" : "Next"}</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

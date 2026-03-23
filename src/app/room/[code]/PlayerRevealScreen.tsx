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

// Per-book vote selections (before submission)
interface BookVoteSelection {
  sketchEntryId?: string;
  guessEntryId?: string;
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

  // Voting state
  const [voteSelections, setVoteSelections] = useState<Record<string, BookVoteSelection>>({});
  const [submittedBookIds, setSubmittedBookIds] = useState<Set<string>>(new Set());
  const [submittingBookId, setSubmittingBookId] = useState<string | null>(null);

  // Leaderboard (friendly mode after scoring:complete)
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

  // Voting: show panel when all entries of the current book have been revealed
  const isLastEntryOfBook =
    currentBook !== undefined &&
    entryIndex === currentBook.entries.length - 1;

  // Entries in current book split by type, excluding player's own entries
  const votableDrawings = currentBook?.entries.filter(
    (e) => e.type === "drawing" && e.authorPlayerId !== playerId
  ) ?? [];
  const votableGuesses = currentBook?.entries.filter(
    (e) => e.type === "guess" && e.authorPlayerId !== playerId
  ) ?? [];

  const currentBookVote = voteSelections[currentBook?.id ?? ""] ?? {};
  const hasVotedCurrentBook = currentBook && submittedBookIds.has(currentBook.id);
  const showVotingPanel =
    scoringMode === "friendly" &&
    isLastEntryOfBook &&
    !hasVotedCurrentBook &&
    (votableDrawings.length > 0 || votableGuesses.length > 0);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await debugFetch(`/api/rooms/${code}/reveal/advance`, { method: "POST" });
    } finally {
      setAdvancing(false);
    }
  }

  async function submitBookVotes(bookId: string) {
    if (submittingBookId) return;
    setSubmittingBookId(bookId);
    const selection = voteSelections[bookId] ?? {};
    const votePromises: Promise<Response>[] = [];

    if (selection.sketchEntryId) {
      votePromises.push(
        debugFetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            entryId: selection.sketchEntryId,
            voteType: "favorite_sketch",
          }),
        })
      );
    }
    if (selection.guessEntryId) {
      votePromises.push(
        debugFetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            entryId: selection.guessEntryId,
            voteType: "favorite_guess",
          }),
        })
      );
    }

    await Promise.allSettled(votePromises);
    setSubmittedBookIds((prev) => new Set([...prev, bookId]));
    setSubmittingBookId(null);
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

  // After reveal ends — friendly mode: wait for leaderboard
  if (finished && scoringMode === "friendly") {
    const allBooksVoted = books.every((b) => submittedBookIds.has(b.id));
    return (
      <main className="flex-1 px-6 pt-12 pb-32 max-w-lg mx-auto w-full space-y-8">
        <section className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-secondary-container rounded-full sketch-shadow-secondary mb-2 transform rotate-2">
            <span className="text-5xl">🎉</span>
          </div>
          <h2 className="font-headline font-extrabold text-4xl text-on-surface tracking-tight">Reveal Complete!</h2>
          
          {!allBooksVoted && books.length > 0 && (
            <div className="bg-tertiary-container p-4 rounded-xl shadow-inner mt-4 border border-tertiary/20">
              <p className="font-label text-xs uppercase tracking-widest text-on-tertiary-container font-bold">
                Action Required
              </p>
              <p className="font-body text-on-surface-variant mt-1 text-sm font-medium">Cast your remaining votes below.</p>
            </div>
          )}
        </section>

        {!allBooksVoted && books.length > 0 && (
          <div className="space-y-8">
            {books.filter((b) => !submittedBookIds.has(b.id)).map((book) => (
              <VotePanel
                key={book.id}
                book={book}
                playerId={playerId}
                selection={voteSelections[book.id] ?? {}}
                onSelect={(field, entryId) =>
                  setVoteSelections((prev) => ({
                    ...prev,
                    [book.id]: { ...prev[book.id], [field]: entryId },
                  }))
                }
                onSubmit={() => submitBookVotes(book.id)}
                submitting={submittingBookId === book.id}
              />
            ))}
          </div>
        )}

        {allBooksVoted && (
          <div className="bg-surface-container-lowest p-8 rounded-xl sketch-shadow border border-outline-variant/10 text-center transform -rotate-1">
            <span className="material-symbols-outlined text-4xl text-outline-variant animate-spin block mb-4" style={{animationDuration: "4s"}}>settings</span>
            <p className="font-label font-bold text-on-surface uppercase tracking-widest text-sm">Waiting for Host</p>
            <p className="font-body text-on-surface-variant mt-2 text-sm font-medium">Sit tight while the host unveils the final leaderboard.</p>
          </div>
        )}
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
          {scoringMode === "friendly" ? "Friendly Mode" : "Competitive Mode"}
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

      {/* Per-book voting panel (friendly mode, last entry visible, not yet voted) */}
      {showVotingPanel && (
        <VotePanel
          book={currentBook}
          playerId={playerId}
          selection={currentBookVote}
          onSelect={(field, entryId) =>
            setVoteSelections((prev) => ({
              ...prev,
              [currentBook.id]: { ...prev[currentBook.id], [field]: entryId },
            }))
          }
          onSubmit={() => submitBookVotes(currentBook.id)}
          submitting={submittingBookId === currentBook.id}
        />
      )}
    </main>
  );
}

// ── VotePanel ──────────────────────────────────────────────────────────────────

interface VotePanelProps {
  book: Book;
  playerId: string;
  selection: BookVoteSelection;
  onSelect: (field: "sketchEntryId" | "guessEntryId", entryId: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}

function VotePanel({ book, playerId, selection, onSelect, onSubmit, submitting }: VotePanelProps) {
  const votableDrawings = book.entries.filter(
    (e) => e.type === "drawing" && e.authorPlayerId !== playerId
  );
  const votableGuesses = book.entries.filter(
    (e) => e.type === "guess" && e.authorPlayerId !== playerId
  );

  const canSubmit =
    (votableDrawings.length === 0 || selection.sketchEntryId) &&
    (votableGuesses.length === 0 || selection.guessEntryId);

  return (
    <div className="bg-tertiary-container rounded-xl p-6 mt-8 relative sketch-shadow transform rotate-[1deg] border border-tertiary/10">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-tertiary px-3 py-1 text-on-tertiary rounded shadow-inner transform -rotate-2">
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>how_to_vote</span>
        </div>
        <h3 className="font-headline font-extrabold text-lg text-tertiary-dim uppercase tracking-tight">
          Cast Your Votes!
        </h3>
      </div>

      <div className="space-y-6">
        {votableDrawings.length > 0 && (
          <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 shadow-sm">
            <p className="font-label text-xs font-bold text-outline-variant uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">palette</span>
              Best Sketch
            </p>
            <div className="grid grid-cols-1 gap-2">
              {votableDrawings.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onSelect("sketchEntryId", entry.id)}
                  className={`px-4 py-3 rounded-lg text-left transition-all font-body font-semibold text-sm ${
                    selection.sketchEntryId === entry.id
                      ? "bg-secondary-container text-on-secondary-container border-2 border-secondary sketch-shadow-secondary scale-[1.02]"
                      : "bg-surface-container-high text-on-surface border-2 border-transparent hover:bg-surface-container-highest"
                  }`}
                >
                  {entry.authorNickname}&apos;s drawing
                </button>
              ))}
            </div>
          </div>
        )}

        {votableGuesses.length > 0 && (
          <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 shadow-sm">
            <p className="font-label text-xs font-bold text-outline-variant uppercase tracking-widest mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">psychology</span>
              Best Guess
            </p>
            <div className="grid grid-cols-1 gap-2">
              {votableGuesses.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onSelect("guessEntryId", entry.id)}
                  className={`px-4 py-3 rounded-lg text-left transition-all font-body flex flex-col gap-1 ${
                    selection.guessEntryId === entry.id
                      ? "bg-secondary-container text-on-secondary-container border-2 border-secondary sketch-shadow-secondary scale-[1.02]"
                      : "bg-surface-container-high text-on-surface border-2 border-transparent hover:bg-surface-container-highest"
                  }`}
                >
                  <span className="font-headline font-bold text-lg italic tracking-tight">&ldquo;{entry.content}&rdquo;</span>
                  <span className={`text-[10px] font-label font-bold uppercase tracking-widest ${selection.guessEntryId === entry.id ? 'opacity-80' : 'text-outline-variant'}`}>
                    By {entry.authorNickname}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="w-full py-4 rounded-xl font-headline text-lg font-extrabold transition-all uppercase tracking-wide flex items-center justify-center gap-2 disabled:opacity-40 disabled:scale-100 disabled:shadow-none hover:-translate-y-1 hover:shadow-lg active:scale-95 active:shadow-md
            bg-on-tertiary-container text-tertiary-container shadow-[4px_4px_0px_0px_#433700]"
        >
          {submitting ? (
            <span className="material-symbols-outlined animate-spin font-bold">autorenew</span>
          ) : (
            <span className="material-symbols-outlined font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>
          )}
          {submitting ? "Locking it in..." : "Submit Votes"}
        </button>
      </div>
    </div>
  );
}

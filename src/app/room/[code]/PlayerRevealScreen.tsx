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
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">Loading reveal…</p>
      </div>
    );
  }

  // Leaderboard screen (after host tallies)
  if (leaderboard) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 w-full max-w-sm">
        <div className="text-5xl">🏆</div>
        <h2 className="text-2xl font-black">Leaderboard</h2>
        <div className="w-full flex flex-col gap-3">
          {leaderboard.map((entry, i) => (
            <div
              key={entry.playerId}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors ${
                entry.playerId === playerId
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200"
              }`}
            >
              <span className="font-bold text-gray-500 w-6 text-center">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
              </span>
              <span className="flex-1 font-medium">{entry.nickname}</span>
              <span className="font-bold text-yellow-600">{entry.totalPoints ?? 0} pts</span>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <p className="text-center text-gray-400 text-sm">No votes were cast.</p>
          )}
        </div>
      </div>
    );
  }

  // After reveal ends — friendly mode: wait for leaderboard
  if (finished && scoringMode === "friendly") {
    const allBooksVoted = books.every((b) => submittedBookIds.has(b.id));
    return (
      <div className="flex flex-col items-center gap-6 py-16 w-full max-w-sm">
        <div className="text-5xl">🎉</div>
        <h2 className="text-2xl font-black">Reveal Complete!</h2>
        {!allBooksVoted && books.length > 0 && (
          <>
            <p className="text-gray-500 text-sm text-center">
              Cast your remaining votes before the leaderboard:
            </p>
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
          </>
        )}
        <p className="text-gray-400 text-sm text-center">
          {allBooksVoted
            ? "Waiting for the host to reveal the leaderboard…"
            : ""}
        </p>
      </div>
    );
  }

  if (finished || !currentBook || !currentEntry) {
    return (
      <div className="flex flex-col items-center gap-6 py-16">
        <div className="text-6xl">🎉</div>
        <h2 className="text-3xl font-black">Game Over!</h2>
        <p className="text-gray-500 text-center">Thanks for playing!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 w-full max-w-sm">
      {/* Book header */}
      <div
        className={`rounded-xl border-2 px-4 py-3 transition-colors ${
          isMyBook ? "border-blue-500 bg-blue-50" : "border-gray-200"
        }`}
      >
        <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">
          {isMyBook ? "Your book" : `${currentBook.ownerNickname}'s book`}
        </p>
        <p className="font-semibold text-gray-800">
          &ldquo;{currentBook.originalPrompt}&rdquo;
        </p>
      </div>

      {/* Entry */}
      <div
        className={`rounded-xl border-2 transition-colors overflow-hidden ${
          isMyEntry ? "border-yellow-400 bg-yellow-50" : "border-gray-200"
        }`}
      >
        {isMyEntry && (
          <div className="bg-yellow-400 px-4 py-1.5 flex items-center gap-2">
            <span className="text-sm font-bold text-yellow-900">⭐ You made this!</span>
          </div>
        )}
        <div className="p-4">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">
            {currentEntry.authorNickname} {currentEntry.type === "drawing" ? "drew" : "guessed"}
          </p>

          {currentEntry.type === "drawing" ? (
            <DrawingCanvas
              onSubmit={() => undefined}
              replayStrokes={replayStrokes}
              readOnly
            />
          ) : (
            <p className="text-2xl font-bold text-gray-900 text-center py-4">
              &ldquo;{currentEntry.content}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between text-sm text-gray-400 px-1">
        <span>Book {bookIndex + 1} of {books.length}</span>
        <div className="flex gap-1.5">
          {currentBook.entries.map((_, i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === entryIndex ? "bg-gray-700" : i < entryIndex ? "bg-gray-400" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <span>Entry {entryIndex + 1} of {currentBook.entries.length}</span>
      </div>

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

      {isHost ? (
        <button
          onClick={handleAdvance}
          disabled={advancing}
          className="w-full py-3 rounded-xl text-base font-bold bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800 transition-colors"
        >
          {advancing ? "…" : entryIndex + 1 < (currentBook?.entries.length ?? 0) ? "Next Entry →" : bookIndex + 1 < books.length ? "Next Book →" : "Finish"}
        </button>
      ) : (
        <p className="text-center text-xs text-gray-400">
          Waiting for host to advance…
        </p>
      )}
    </div>
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
    <div className="rounded-xl border-2 border-purple-300 bg-purple-50 p-4 flex flex-col gap-4">
      <h3 className="text-sm font-bold text-purple-800 uppercase tracking-wider">
        Vote for your favorites
      </h3>

      {votableDrawings.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">🎨 Best sketch</p>
          <div className="flex flex-col gap-2">
            {votableDrawings.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onSelect("sketchEntryId", entry.id)}
                className={`px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                  selection.sketchEntryId === entry.id
                    ? "border-purple-500 bg-purple-100 font-semibold"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                {entry.authorNickname}&apos;s drawing
              </button>
            ))}
          </div>
        </div>
      )}

      {votableGuesses.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">💬 Best guess</p>
          <div className="flex flex-col gap-2">
            {votableGuesses.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onSelect("guessEntryId", entry.id)}
                className={`px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                  selection.guessEntryId === entry.id
                    ? "border-purple-500 bg-purple-100 font-semibold"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                &ldquo;{entry.content}&rdquo;
                <span className="text-gray-400 text-xs ml-1">— {entry.authorNickname}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="w-full py-2.5 rounded-xl text-sm font-bold bg-purple-600 text-white disabled:opacity-40 hover:bg-purple-700 transition-colors"
      >
        {submitting ? "Submitting…" : "Submit Votes"}
      </button>
    </div>
  );
}

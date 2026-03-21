"use client";

import { useEffect, useMemo, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
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

interface Props {
  code: string;
  playerId: string;
  isHost?: boolean;
  initialBookIndex: number;
  initialEntryIndex: number;
}

export function PlayerRevealScreen({
  code,
  playerId,
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

  // Fetch all book+entry data on mount
  useEffect(() => {
    fetch(`/api/rooms/${code}/reveal/books`)
      .then((r) => r.json())
      .then((data: { books: Book[]; revealBookIndex: number; revealEntryIndex: number }) => {
        setBooks(data.books);
        // Sync indices from DB in case an advance happened between server render and mount
        if (typeof data.revealBookIndex === "number") setBookIndex(data.revealBookIndex);
        if (typeof data.revealEntryIndex === "number") setEntryIndex(data.revealEntryIndex);
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

  const currentBook = books[bookIndex];
  const currentEntry = currentBook?.entries[entryIndex];

  const isMyBook = currentBook?.ownerPlayerId === playerId;
  const isMyEntry = currentEntry?.authorPlayerId === playerId;

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await fetch(`/api/rooms/${code}/reveal/advance`, { method: "POST" });
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
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">Loading reveal…</p>
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

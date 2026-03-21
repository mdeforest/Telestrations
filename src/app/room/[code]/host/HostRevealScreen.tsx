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
  initialBookIndex: number;
  initialEntryIndex: number;
}

export function HostRevealScreen({ code, initialBookIndex, initialEntryIndex }: Props) {
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
      .then((data: { books: Book[] }) => {
        setBooks(data.books);
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

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    try {
      await fetch(`/api/rooms/${code}/reveal/advance`, { method: "POST" });
    } finally {
      setAdvancing(false);
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
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading reveal…</p>
      </div>
    );
  }

  if (finished || !currentBook || !currentEntry) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6">
        <div className="text-8xl">🎉</div>
        <h1 className="text-5xl font-black">Game Over!</h1>
        <p className="text-xl text-gray-500">Thanks for playing</p>
      </div>
    );
  }

  const totalBooks = books.length;
  const totalEntries = currentBook.entries.length;

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">
      {/* Top bar — book progress */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-gray-800">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest">Book</p>
          <p className="text-2xl font-bold">
            {currentBook.ownerNickname}&apos;s story
          </p>
          <p className="text-sm text-gray-400">
            Prompt: <span className="text-white font-medium">&ldquo;{currentBook.originalPrompt}&rdquo;</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400 uppercase tracking-widest">Progress</p>
          <p className="text-lg font-mono">
            {bookIndex + 1} / {totalBooks}
          </p>
          <p className="text-sm text-gray-400">
            Entry {entryIndex + 1} of {totalEntries}
          </p>
        </div>
      </header>

      {/* Main entry display */}
      <main className="flex-1 flex flex-col items-center justify-center gap-8 px-8 py-12">
        {/* Author badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-800 border border-gray-700">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-sm font-medium">
            {currentEntry.authorNickname}
          </span>
          <span className="text-xs text-gray-400">
            {currentEntry.type === "drawing" ? "drew" : "guessed"}
          </span>
        </div>

        {/* Entry content */}
        {currentEntry.type === "drawing" ? (
          <div className="w-full max-w-xl">
            <DrawingCanvas
              onSubmit={() => undefined}
              replayStrokes={replayStrokes}
              readOnly
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <p className="text-xs text-gray-400 uppercase tracking-widest">They guessed…</p>
            <p className="text-6xl font-black text-center max-w-2xl leading-tight">
              &ldquo;{currentEntry.content}&rdquo;
            </p>
          </div>
        )}
      </main>

      {/* Entry progress dots */}
      <div className="flex justify-center gap-3 pb-6">
        {currentBook.entries.map((_, i) => (
          <span
            key={i}
            className={`w-3 h-3 rounded-full transition-colors ${
              i === entryIndex ? "bg-white" : i < entryIndex ? "bg-gray-500" : "bg-gray-700"
            }`}
          />
        ))}
      </div>

      {/* Advance button — stays fixed at bottom */}
      <footer className="px-8 pb-8 flex justify-center">
        <button
          onClick={handleAdvance}
          disabled={advancing}
          className="px-12 py-4 rounded-2xl text-xl font-bold bg-white text-gray-950 disabled:opacity-50 hover:bg-gray-100 transition-colors shadow-lg"
        >
          {advancing ? "…" : entryIndex + 1 < totalEntries ? "Next Entry →" : bookIndex + 1 < totalBooks ? "Next Book →" : "Finish"}
        </button>
      </footer>
    </div>
  );
}

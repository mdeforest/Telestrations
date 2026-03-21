"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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

/** Single step in the chain timeline: prompt → drawing → guess → … */
function ChainStep({
  label,
  content,
  isActive,
  isFuture,
}: {
  label: string;
  content: string;
  isActive: boolean;
  isFuture: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1 transition-opacity ${
        isFuture ? "opacity-20" : "opacity-100"
      }`}
    >
      <div
        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors max-w-[120px] text-center truncate ${
          isActive
            ? "bg-white text-gray-950 border-white"
            : "bg-gray-800 text-gray-300 border-gray-700"
        }`}
        title={content}
      >
        {content.length > 16 ? content.slice(0, 14) + "…" : content}
      </div>
      <p className="text-xs text-gray-500 truncate max-w-[120px] text-center">{label}</p>
    </div>
  );
}

function ChainArrow() {
  return <span className="text-gray-700 text-lg self-center pb-4">→</span>;
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
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <p className="text-gray-400 text-lg">Loading reveal…</p>
      </div>
    );
  }

  if (finished || !currentBook || !currentEntry) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-white gap-6">
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
          <p className="text-xs text-gray-400 uppercase tracking-widest">
            Book {bookIndex + 1} of {totalBooks}
          </p>
          <p className="text-2xl font-bold">
            {currentBook.ownerNickname}&apos;s story
          </p>
        </div>
        <div className="text-right text-sm text-gray-400">
          Entry {entryIndex + 1} of {totalEntries}
        </div>
      </header>

      {/* Main entry display */}
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-8 py-8">
        {/* Author badge */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-800 border border-gray-700">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-sm font-medium">{currentEntry.authorNickname}</span>
          <span className="text-xs text-gray-400">
            {currentEntry.type === "drawing" ? "drew" : "guessed"}
          </span>
        </div>

        {/* Entry content — full-screen focal point */}
        {currentEntry.type === "drawing" ? (
          <div className="w-full max-w-xl">
            <DrawingCanvas
              onSubmit={() => undefined}
              replayStrokes={replayStrokes}
              readOnly
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-gray-400 uppercase tracking-widest">They guessed…</p>
            <p className="text-6xl font-black text-center max-w-2xl leading-tight">
              &ldquo;{currentEntry.content}&rdquo;
            </p>
          </div>
        )}
      </main>

      {/* Chain timeline — prompt → entries revealed so far */}
      <div className="px-8 py-4 border-t border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 text-center">
          Chain so far
        </p>
        <div className="flex items-start justify-center gap-2 overflow-x-auto pb-1">
          {/* Original prompt */}
          <ChainStep
            label={`📝 ${currentBook.ownerNickname}`}
            content={`"${currentBook.originalPrompt}"`}
            isActive={false}
            isFuture={false}
          />

          {/* Each entry — active = current, future = not yet revealed */}
          {currentBook.entries.map((entry, i) => (
            <Fragment key={entry.id}>
              <ChainArrow />
              <ChainStep
                label={`${entry.type === "drawing" ? "🎨" : "💬"} ${entry.authorNickname}`}
                content={
                  entry.type === "drawing"
                    ? "(drawing)"
                    : `"${entry.content}"`
                }
                isActive={i === entryIndex}
                isFuture={i > entryIndex}
              />
            </Fragment>
          ))}
        </div>
      </div>

      {/* Advance button */}
      <footer className="px-8 pb-8 pt-4 flex justify-center">
        <button
          onClick={handleAdvance}
          disabled={advancing}
          className="px-12 py-4 rounded-2xl text-xl font-bold bg-white text-gray-950 disabled:opacity-50 hover:bg-gray-100 transition-colors shadow-lg"
        >
          {advancing
            ? "…"
            : entryIndex + 1 < totalEntries
            ? "Next Entry →"
            : bookIndex + 1 < totalBooks
            ? "Next Book →"
            : "Finish"}
        </button>
      </footer>
    </div>
  );
}

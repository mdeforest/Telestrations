"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  players: Player[];
  initialSelectedCount?: number;
}

export function HostPromptsWaiting({
  code,
  players,
  initialSelectedCount = 0,
}: Props) {
  const [selectedCount, setSelectedCount] = useState(initialSelectedCount);
  // Track which players have selected (by index up to selectedCount)
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ably = getAblyClient();

    // Listen for each player's prompt selection
    const promptsCh = ably.channels.get(channels.roomPrompts(code));
    promptsCh.subscribe("prompt-selected", (msg) => {
      const { selectedCount: count, playerId } = msg.data as {
        selectedCount: number;
        totalCount: number;
        playerId?: string;
      };
      setSelectedCount(count);
      if (playerId) {
        setSelectedPlayerIds((prev) => new Set([...prev, playerId]));
      }
    });

    return () => {
      promptsCh.unsubscribe();
    };
  }, [code]);

  const totalPlayers = players.length;
  const remaining = totalPlayers - selectedCount;
  const percentage = Math.round((selectedCount / totalPlayers) * 100) || 0;

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen selection:bg-primary-container selection:text-on-primary-container w-full absolute top-0 left-0 right-0 z-10">
      {/* TopAppBar */}
      <nav className="fixed top-0 left-0 w-full z-50 bg-[#fcf6ed]/95 backdrop-blur-md px-8 py-6 flex justify-between items-center max-w-full lg:px-12 border-b-2 border-outline-variant/10 shadow-sm">
        <div className="flex items-center gap-6">
          <span className="text-3xl font-black text-primary truncate max-w-[200px] md:max-w-none">The Animated Sketchpad</span>
          <div className="bg-surface-variant h-8 w-1 mx-2 hidden md:block"></div>
          <h1 className="text-on-surface font-headline font-extrabold truncate hidden md:block">Round 1: Prompt Selection</h1>
        </div>
        <div className="flex items-center gap-6">
          {/* Pending count pill */}
          <div className="bg-tertiary-container border-tertiary text-on-tertiary-container px-6 py-2 rounded-xl flex items-center gap-3 border-2 shadow-sm">
            <span className="material-symbols-outlined text-inherit">pending</span>
            <span className="font-label font-bold text-xl tracking-tighter">
              {remaining} left
            </span>
          </div>
        </div>
      </nav>

      {/* Content Canvas */}
      <main className="pt-32 pb-40 px-6 lg:px-12 paper-texture min-h-[100dvh]">
        {/* Room Code & Info */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
          <div>
            <p className="font-label uppercase tracking-widest text-on-surface-variant mb-2">Room Code</p>
            <div className="bg-secondary-container text-secondary font-label font-bold text-4xl px-8 py-3 rounded-lg tracking-[0.2em] sketch-shadow-secondary inline-block border border-secondary/20">
              {code}
            </div>
          </div>
          <div className="md:text-right bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/20 shadow-sm">
            <h2 className="font-headline text-xl font-bold text-on-surface-variant">Waiting for prompts...</h2>
            <p className="font-body text-outline font-medium">Everyone is picking their starting word</p>
          </div>
        </div>

        {/* Players Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8 max-w-[1600px] mx-auto">
          {players.map((p, index) => {
            // A player is "done" if their index is within the selectedCount,
            // or if we have their specific ID in our tracking set.
            const isDone = selectedPlayerIds.has(p.id) || index < selectedCount;
            const initials = p.nickname.slice(0, 2).toUpperCase();

            const rotation =
              index % 4 === 0
                ? "hover:-rotate-1"
                : index % 4 === 1
                ? "hover:rotate-1"
                : index % 4 === 2
                ? "hover:-rotate-2 transform rotate-1"
                : "hover:rotate-2 transform -rotate-1";

            const avatarBg =
              index % 3 === 0
                ? "bg-secondary-fixed border-secondary text-secondary-dim"
                : index % 3 === 1
                ? "bg-primary-fixed border-primary text-primary-dim"
                : "bg-tertiary-fixed border-tertiary text-tertiary-dim";

            const roleBg =
              index % 3 === 0
                ? "bg-secondary/10 text-secondary"
                : index % 3 === 1
                ? "bg-primary/10 text-primary"
                : "bg-tertiary/20 text-tertiary-dim";

            return (
              <div
                key={p.id}
                className={`${
                  isDone
                    ? "bg-surface-container-lowest sketch-shadow-primary border-primary border-2"
                    : "bg-surface-container-low border-outline-variant/20 border-2 shadow-sm"
                } p-6 rounded-lg relative group transition-transform ${rotation}`}
              >
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 mb-6">
                  <div className={`w-16 h-16 shrink-0 rounded-full flex items-center justify-center border-2 overflow-hidden font-headline text-2xl font-black ${avatarBg}`}>
                    {initials}
                  </div>
                  <div className="flex flex-col items-center sm:items-start min-w-0">
                    <h3 className="font-headline font-extrabold text-xl truncate w-full" title={p.nickname}>
                      {p.nickname}
                    </h3>
                    <span className={`font-label text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mt-1 inline-block ${roleBg}`}>
                      Player
                    </span>
                  </div>
                </div>

                {isDone ? (
                  <div className="bg-primary-container text-on-primary-container py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    <span className="font-label font-bold uppercase tracking-wider text-xs">Locked In!</span>
                  </div>
                ) : (
                  <div className="bg-surface-container-high text-on-surface-variant py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-outline-variant/20">
                    <span className="material-symbols-outlined animate-bounce text-sm">edit_note</span>
                    <span className="font-label font-bold uppercase tracking-wider text-xs">Choosing...</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Footer Progress Section */}
      <footer className="fixed bottom-0 left-0 w-full z-50 flex flex-col justify-center items-center px-6 lg:px-16 py-6 lg:py-8 bg-[#ffffff]/95 backdrop-blur-md rounded-t-[3rem] border-t-2 border-[#e2dcd1] shadow-[0px_-20px_40px_rgba(49,46,41,0.08)]">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center w-full">
          <div className="flex justify-between items-end w-full max-w-3xl mb-3">
            <span className="font-label font-black text-primary text-sm uppercase tracking-widest px-4">{selectedCount} of {totalPlayers} Locked In</span>
            <span className="font-label font-bold text-outline-variant text-xs tracking-widest px-4">{percentage}%</span>
          </div>
          <div className="h-6 w-full max-w-3xl bg-surface-container-low rounded-full overflow-hidden p-1 border border-outline-variant/10 shadow-inner">
            <div className="h-full bg-primary rounded-full transition-all duration-1000 ease-out relative shadow-sm" style={{ width: `${percentage}%` }}>
              <div className="absolute inset-0 bg-white/20 skew-x-12 scale-110"></div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

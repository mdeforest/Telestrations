"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

interface Props {
  code: string;
  totalPlayers: number;
  initialSelectedCount?: number;
}

export function HostPromptsWaiting({
  code,
  totalPlayers,
  initialSelectedCount = 0,
}: Props) {
  const [selectedCount, setSelectedCount] = useState(initialSelectedCount);

  useEffect(() => {
    const ably = getAblyClient();

    // Listen for each player's prompt selection
    const promptsCh = ably.channels.get(channels.roomPrompts(code));
    promptsCh.subscribe("prompt-selected", (msg) => {
      const { selectedCount: count } = msg.data as { selectedCount: number; totalCount: number };
      setSelectedCount(count);
    });

    // Room going active triggers a page reload (server re-renders game view)
    const statusCh = ably.channels.get(channels.roomStatus(code));
    statusCh.subscribe("room-status-changed", (msg) => {
      const { status } = msg.data as { status: string };
      if (status === "active") {
        window.location.reload();
      }
    });

    return () => {
      promptsCh.unsubscribe();
      statusCh.unsubscribe();
    };
  }, [code]);

  const remaining = totalPlayers - selectedCount;

  return (
    <div className="flex flex-col items-center gap-8 py-8 w-full max-w-lg">
      <div className="text-center">
        <p className="text-sm text-gray-500 uppercase tracking-widest mb-2">Round 1</p>
        <h2 className="text-3xl font-bold">Waiting for players to choose prompts</h2>
      </div>

      {/* Progress bar */}
      <div className="w-full">
        <div className="flex justify-between text-sm text-gray-500 mb-2">
          <span>{selectedCount} of {totalPlayers} selected</span>
          <span>{remaining} remaining</span>
        </div>
        <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${(selectedCount / totalPlayers) * 100}%` }}
          />
        </div>
      </div>

      {/* Player dots */}
      <div className="flex gap-3 flex-wrap justify-center">
        {Array.from({ length: totalPlayers }, (_, i) => (
          <div
            key={i}
            className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-colors ${
              i < selectedCount
                ? "bg-blue-500 border-blue-500 text-white"
                : "bg-gray-50 border-gray-200 text-gray-300"
            }`}
          >
            {i < selectedCount ? "✓" : i + 1}
          </div>
        ))}
      </div>

      <p className="text-gray-400 text-sm animate-pulse">
        The round begins automatically once everyone has chosen…
      </p>
    </div>
  );
}

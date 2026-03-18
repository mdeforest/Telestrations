"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  initialPlayers: Player[];
  hostPlayerId: string;
  initialNumRounds: number;
  initialScoringMode: "friendly" | "competitive";
  connectUrl: string;
}

export function HostLobby({
  code,
  initialPlayers,
  hostPlayerId,
  initialNumRounds,
  initialScoringMode,
  connectUrl,
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [numRounds, setNumRounds] = useState(initialNumRounds);
  const [scoringMode, setScoringMode] = useState<"friendly" | "competitive">(initialScoringMode);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const canStart = playerList.length >= 4;

  useEffect(() => {
    const ably = getAblyClient();
    const channel = ably.channels.get(channels.roomPlayers(code));

    channel.subscribe("players-updated", (msg) => {
      const { players } = msg.data as { players: Player[]; hostPlayerId: string };
      setPlayerList(players);
    });

    channel.subscribe("host-phone-connected", () => {
      setPhoneConnected(true);
    });

    return () => {
      channel.unsubscribe();
    };
  }, [code]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numRounds, scoringMode }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to start game");
        setStarting(false);
      }
      // On success the server will transition the room — realtime event will drive navigation
    } catch {
      setError("Network error");
      setStarting(false);
    }
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      {/* QR code — opt-in so other players at the TV don't accidentally scan it.
           phoneConnected only controls the label; showQr controls visibility. */}
      <section className="flex flex-col items-center gap-2">
        {showQr ? (
          <>
            <QRCodeSVG value={connectUrl} size={160} />
            <p className={`text-xs font-medium ${phoneConnected ? "text-green-600" : "text-gray-500"}`}>
              {phoneConnected ? "✓ Phone connected" : "Scan to play on your phone"}
            </p>
          </>
        ) : (
          <button
            onClick={() => setShowQr(true)}
            className="text-sm text-blue-600 underline underline-offset-2"
          >
            {phoneConnected ? "✓ Phone connected — scan again" : "Connect your phone"}
          </button>
        )}
      </section>

      {/* Live player list */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
          Players ({playerList.length})
        </h2>
        <ul className="space-y-2">
          {playerList.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3 text-lg"
            >
              <span className="text-gray-400 w-6 text-right">{p.seatOrder}</span>
              <span className="font-medium">{p.nickname}</span>
              {p.id === hostPlayerId && (
                <span className="ml-auto text-xs text-blue-500">host</span>
              )}
            </li>
          ))}
        </ul>
        {!canStart && (
          <p className="mt-3 text-sm text-amber-600">
            Need at least 4 players to start ({4 - playerList.length} more)
          </p>
        )}
      </section>

      {/* Config */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <label htmlFor="rounds" className="font-medium">
            Rounds
          </label>
          <select
            id="rounds"
            value={numRounds}
            onChange={(e) => setNumRounds(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-base bg-white"
          >
            {[3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between">
          <span className="font-medium">Scoring</span>
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {(["friendly", "competitive"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setScoringMode(mode)}
                className={`px-4 py-1.5 capitalize transition-colors ${
                  scoringMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleStart}
        disabled={!canStart || starting}
        className="w-full py-3 rounded-xl text-lg font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
      >
        {starting ? "Starting…" : "Start Game"}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";
import { HostPromptsWaiting } from "./HostPromptsWaiting";
import { HostDrawingScreen } from "./HostDrawingScreen";
import { HostRevealScreen } from "./HostRevealScreen";

interface Player {
  id: string;
  nickname: string;
  seatOrder: number;
}

interface Props {
  code: string;
  initialPlayers: Player[];
  hostPlayerId: string;
  initialStatus?: string;
  initialSelectedCount?: number;
  initialRoundId?: string;
  initialTimerStartedAt?: string | null;
  initialRevealBookIndex?: number;
  initialRevealEntryIndex?: number;
}

export function HostLobby({
  code,
  initialPlayers,
  hostPlayerId,
  initialStatus = "lobby",
  initialSelectedCount = 0,
  initialRoundId,
  initialTimerStartedAt = null,
  initialRevealBookIndex = 0,
  initialRevealEntryIndex = 0,
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [status, setStatus] = useState(initialStatus);
  const [roundId, setRoundId] = useState(initialRoundId ?? "");
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(initialTimerStartedAt);
  const [revealBookIndex, setRevealBookIndex] = useState(initialRevealBookIndex);
  const [revealEntryIndex, setRevealEntryIndex] = useState(initialRevealEntryIndex);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [urlInfo, setUrlInfo] = useState({ connectUrl: "", isLocalhost: false });
  const [numRounds, setNumRounds] = useState(3);
  const [scoringMode, setScoringMode] = useState<"friendly" | "competitive">("friendly");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const canStart = playerList.length >= 4;

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numRounds, scoringMode }),
      });
      if (!res.ok) {
        const data = await res.json();
        setStartError(data.error ?? "Failed to start game");
        setStarting(false);
      }
    } catch {
      setStartError("Network error");
      setStarting(false);
    }
  }

  // Compute connect URL client-side so it reflects window.location (the real IP
  // the browser used), not the Next.js server-side host which normalises to localhost.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrlInfo({
      connectUrl: `${window.location.origin}/room/${code}/connect?pid=${hostPlayerId}`,
      isLocalhost:
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1",
    });
  }, [code, hostPlayerId]);

  useEffect(() => {
    const ably = getAblyClient();

    const playersCh = ably.channels.get(channels.roomPlayers(code));
    playersCh.subscribe("players-updated", (msg) => {
      const { players } = msg.data as { players: Player[]; hostPlayerId: string };
      setPlayerList(players);
    });

    playersCh.subscribe("host-phone-connected", () => {
      setPhoneConnected(true);
    });

    const statusCh = ably.channels.get(channels.roomStatus(code));
    statusCh.subscribe("room-status-changed", (msg) => {
      const { status: newStatus, roundId: newRoundId, timerStartedAt: newTimer } = msg.data as {
        status: string;
        roundId?: string;
        timerStartedAt?: string | null;
      };
      setStatus(newStatus);
      if (newRoundId) setRoundId(newRoundId);
      if (newTimer !== undefined) setTimerStartedAt(newTimer);
    });

    const revealCh = ably.channels.get(channels.revealAdvance(code));
    revealCh.subscribe("reveal:advance", (msg) => {
      const { revealBookIndex: bIdx, revealEntryIndex: eIdx } = msg.data as {
        revealBookIndex: number;
        revealEntryIndex: number;
        finished: boolean;
      };
      setRevealBookIndex(bIdx);
      setRevealEntryIndex(eIdx);
    });

    return () => {
      playersCh.unsubscribe();
      statusCh.unsubscribe();
      revealCh.unsubscribe();
    };
  }, [code]);

  if (status === "active" && roundId) {
    return (
      <HostDrawingScreen
        code={code}
        roundId={roundId}
        timerStartedAt={timerStartedAt}
      />
    );
  }

  if (status === "reveal" || status === "finished") {
    return (
      <HostRevealScreen
        code={code}
        initialBookIndex={revealBookIndex}
        initialEntryIndex={revealEntryIndex}
      />
    );
  }

  if (status === "prompts") {
    return (
      <HostPromptsWaiting
        code={code}
        totalPlayers={playerList.length}
        initialSelectedCount={initialSelectedCount}
      />
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      {/* QR code — opt-in so other players at the TV don't accidentally scan it */}
      <section className="flex flex-col items-center gap-2">
        {urlInfo.isLocalhost && (
          <p className="text-xs text-amber-600 text-center">
            Open this page via your local IP so the QR works on your phone.
          </p>
        )}
        {showQr && urlInfo.connectUrl ? (
          <>
            <QRCodeSVG value={urlInfo.connectUrl} size={160} />
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
        {playerList.length < 4 && (
          <p className="mt-3 text-sm text-amber-600">
            Waiting for players… ({playerList.length} / 4 minimum)
          </p>
        )}
      </section>

      <section className="flex flex-col gap-4 border-t pt-4">
        <div className="flex items-center justify-between">
          <label htmlFor="host-rounds" className="font-medium">Rounds</label>
          <select
            id="host-rounds"
            value={numRounds}
            onChange={(e) => setNumRounds(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-base bg-white"
          >
            {[3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
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

        {startError && <p className="text-sm text-red-600">{startError}</p>}

        <button
          onClick={handleStart}
          disabled={!canStart || starting}
          className="w-full py-3 rounded-xl text-lg font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
        >
          {starting ? "Starting…" : "Start Game"}
        </button>
      </section>
    </div>
  );
}

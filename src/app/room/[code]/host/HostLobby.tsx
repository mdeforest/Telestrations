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
  initialScoringMode?: "friendly" | "competitive";
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
  initialScoringMode = "friendly",
}: Props) {
  const [playerList, setPlayerList] = useState<Player[]>(initialPlayers);
  const [status, setStatus] = useState(initialStatus);
  const [roundId, setRoundId] = useState(initialRoundId ?? "");
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(initialTimerStartedAt);
  const [revealBookIndex, setRevealBookIndex] = useState(initialRevealBookIndex);
  const [revealEntryIndex, setRevealEntryIndex] = useState(initialRevealEntryIndex);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [urlInfo, setUrlInfo] = useState({ connectUrl: "", playerJoinUrl: "", isLocalhost: false });
  const numRounds = 3;
  const scoringMode = initialScoringMode;

  // Compute URLs client-side so they reflect window.location (the real IP
  // the browser used), not the Next.js server-side host which normalises to localhost.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrlInfo({
      connectUrl: `${window.location.origin}/room/${code}/connect?pid=${hostPlayerId}`,
      playerJoinUrl: `${window.location.origin}/?code=${code}`,
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
        players={playerList}
      />
    );
  }

  if (status === "reveal" || status === "finished") {
    return (
      <HostRevealScreen
        code={code}
        scoringMode={scoringMode}
        initialBookIndex={revealBookIndex}
        initialEntryIndex={revealEntryIndex}
      />
    );
  }

  if (status === "prompts") {
    return (
      <HostPromptsWaiting
        code={code}
        players={playerList}
        initialSelectedCount={initialSelectedCount}
      />
    );
  }

  return (
    <main className="flex-grow flex flex-col lg:flex-row p-6 lg:p-12 gap-8 lg:gap-12 pb-40 overflow-y-auto w-full max-w-[1400px] mx-auto min-h-screen bg-surface text-on-surface">
      {/* Left: QR Code Panel */}
      <section className="w-full lg:w-1/3 flex flex-col gap-6 shrink-0">
        {/* Zone 1 — Player join QR (prominent) */}
        <div className="bg-surface-container-lowest rounded-xl p-10 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant/30 flex-grow relative min-h-[300px]">
          {urlInfo.playerJoinUrl ? (
            <QRCodeSVG value={urlInfo.playerJoinUrl} size={192} className="mb-6 opacity-90" />
          ) : (
            <div className="w-48 h-48 bg-on-surface rounded-lg p-4 grid grid-cols-4 grid-rows-4 gap-2 opacity-10 mb-6">
              <div className="bg-surface col-span-1 row-span-1"></div>
              <div className="bg-surface col-span-1 row-span-1"></div>
              <div className="bg-surface col-span-1 row-span-1"></div>
              <div className="bg-surface col-span-2 row-span-2"></div>
            </div>
          )}
          <h2 className="font-headline text-2xl font-extrabold text-primary mb-1">Scan to Join!</h2>
          <p className="text-on-surface-variant max-w-xs mx-auto text-sm font-medium text-center">Point your camera here to join the game on your phone.</p>
        </div>

        {/* Zone 2 — Manual fallback */}
        <div className="bg-surface-container-lowest rounded-xl px-6 py-4 flex flex-col items-center text-center border border-outline-variant/20">
          <p className="text-xs text-on-surface-variant font-medium mb-1">Or go to <span className="font-bold text-on-surface">telestrations.com</span> and enter</p>
          <span className="font-headline text-3xl font-black tracking-widest text-on-surface">{code}</span>
        </div>

        {/* Zone 3 — Host QR (blurred/hidden) */}
        {!phoneConnected ? (
          <div
            className="rounded-xl px-6 py-4 flex flex-col items-center text-center border border-dashed border-outline-variant/20 cursor-pointer group"
            onMouseEnter={(e) => (e.currentTarget.querySelector<HTMLDivElement>(".host-qr-inner")!.style.filter = "none")}
            onMouseLeave={(e) => (e.currentTarget.querySelector<HTMLDivElement>(".host-qr-inner")!.style.filter = "blur(8px)")}
          >
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3">👑 Host — hover to reveal your controller QR</p>
            <div className="host-qr-inner transition-all" style={{ filter: "blur(8px)" }}>
              {urlInfo.connectUrl ? (
                <QRCodeSVG value={urlInfo.connectUrl} size={96} />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl px-6 py-4 flex flex-col items-center text-center border border-outline-variant/20">
            <p className="text-xs font-bold text-green-600 uppercase tracking-widest">✓ Host phone connected</p>
          </div>
        )}
      </section>

      {/* Right: Players Grid */}
      <section className="flex-grow flex flex-col gap-6 overflow-hidden max-w-full">
        <div className="flex justify-between items-end mb-2 border-b-2 border-outline-variant/20 pb-4">
          <h3 className="font-headline text-3xl font-black text-secondary tracking-tight">Joined Players <span className="text-primary">({playerList.length}/8)</span></h3>
          <span className="font-label text-on-surface-variant font-bold text-sm tracking-widest uppercase">
            {8 - playerList.length > 0 ? `Waiting for ${8 - playerList.length} more` : "Room is full!"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 content-start pb-10">
          {playerList.map((p, index) => {
            const isHostPlayer = p.id === hostPlayerId;
            const initials = p.nickname.slice(0, 2).toUpperCase();

            // Varied tilt/rotation for players to match living doodle
            const rotation = index % 3 === 0 ? "transform -rotate-1" : index % 3 === 1 ? "transform rotate-2" : "transform -rotate-2";
            const bgRound = index % 3 === 0 ? "bg-secondary text-on-secondary sketch-shadow-secondary border border-secondary" : index % 3 === 1 ? "bg-primary-container text-on-primary-container border border-primary sketch-shadow-primary" : "bg-tertiary-container text-on-tertiary-container border border-tertiary sketch-shadow";
            const cardBg = index % 2 === 0 ? "bg-surface-container-lowest" : "bg-surface-container-low";

            return (
              <div key={p.id} className={`${cardBg} p-6 col-span-1 rounded-xl flex flex-col items-center gap-3 ${rotation} relative shadow-sm border border-outline-variant/10 transition-transform hover:scale-105 min-h-[160px] justify-center`}>
                <div className="relative">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center font-headline text-3xl font-bold ${bgRound}`}>
                    {initials}
                  </div>
                  {isHostPlayer && (
                    <div className="absolute -top-2 -right-2 bg-primary text-white text-[10px] px-2 py-1 rounded-full font-label uppercase font-bold tracking-widest shadow-sm">Host</div>
                  )}
                </div>
                <span className="font-headline text-lg font-bold truncate w-full text-center text-on-surface mt-2">{p.nickname}</span>
                <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] absolute bottom-4"></div>
              </div>
            );
          })}

          {/* Empty Seats */}
          {Array.from({ length: Math.max(0, 8 - playerList.length) }).map((_, i) => (
            <div key={i} className="border-4 border-dashed border-outline-variant/20 p-6 rounded-xl flex flex-col items-center justify-center gap-2 opacity-60 min-h-[160px] bg-surface-container-lowest/50 group hover:border-outline-variant/40 transition-colors">
              <span className="material-symbols-outlined text-4xl text-outline-variant group-hover:scale-110 transition-transform">person_add</span>
              <span className="font-label text-xs uppercase tracking-wider font-bold text-outline-variant">Seat {playerList.length + i + 1}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer Settings (read-only) */}
      <footer className="bg-surface-container-lowest/95 backdrop-blur-md fixed bottom-0 left-0 w-full z-50 rounded-t-[3rem] border-t-2 border-outline-variant/30 shadow-[0px_-20px_40px_rgba(49,46,41,0.08)]">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center px-8 lg:px-16 py-6 lg:py-8 gap-6 md:gap-0">
          <div className="flex flex-col md:flex-row gap-8 lg:gap-12 items-center">
            <div className="flex flex-col items-center md:items-start">
              <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold mb-3">Game Settings</span>
              <div className="flex gap-6 items-center">
                <div className="flex flex-col items-center md:items-start">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Rounds</span>
                  <span className="font-headline text-2xl font-extrabold text-on-surface">{numRounds}</span>
                </div>
                <div className="h-10 w-px bg-outline-variant/30"></div>
                <div className="flex flex-col items-center md:items-start">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Scoring Mode</span>
                  <span className="font-headline text-xl font-extrabold text-on-surface capitalize">{scoringMode}</span>
                </div>
              </div>
              <span className="text-[10px] text-outline-variant mt-2 font-label">Set on host phone</span>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:gap-8 w-full md:w-auto justify-between md:justify-end">
            <div className="flex flex-col items-center bg-secondary-container/30 px-6 py-2 rounded-xl border border-secondary/10">
              <span className="font-label text-[10px] font-bold text-secondary uppercase tracking-widest mb-0.5">Room Code</span>
              <span className="font-headline text-2xl font-black tracking-widest text-on-secondary-container">{code}</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

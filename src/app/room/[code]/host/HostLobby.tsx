"use client";

import { useEffect, useState } from "react";
import Ably from "ably";
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
    const onPlayersUpdated = (msg: Ably.Message) => {
      const { players } = msg.data as { players: Player[]; hostPlayerId: string };
      setPlayerList(players);
    };
    const onPhoneConnected = () => { setPhoneConnected(true); };
    playersCh.subscribe("players-updated", onPlayersUpdated);
    playersCh.subscribe("host-phone-connected", onPhoneConnected);

    const statusCh = ably.channels.get(channels.roomStatus(code));
    const onStatusChanged = (msg: Ably.Message) => {
      const { status: newStatus, roundId: newRoundId, timerStartedAt: newTimer } = msg.data as {
        status: string;
        roundId?: string;
        timerStartedAt?: string | null;
      };
      setStatus(newStatus);
      if (newRoundId) setRoundId(newRoundId);
      if (newTimer !== undefined) setTimerStartedAt(newTimer);
    };
    statusCh.subscribe("room-status-changed", onStatusChanged);

    const revealCh = ably.channels.get(channels.revealAdvance(code));
    const onRevealAdvance = (msg: Ably.Message) => {
      const { revealBookIndex: bIdx, revealEntryIndex: eIdx } = msg.data as {
        revealBookIndex: number;
        revealEntryIndex: number;
        finished: boolean;
      };
      setRevealBookIndex(bIdx);
      setRevealEntryIndex(eIdx);
    };
    revealCh.subscribe("reveal:advance", onRevealAdvance);

    return () => {
      playersCh.unsubscribe("players-updated", onPlayersUpdated);
      playersCh.unsubscribe("host-phone-connected", onPhoneConnected);
      statusCh.unsubscribe("room-status-changed", onStatusChanged);
      revealCh.unsubscribe("reveal:advance", onRevealAdvance);
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
    <div className="h-screen overflow-hidden flex flex-col bg-surface text-on-surface">
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row px-4 py-4 lg:px-8 lg:py-6 xl:px-10 xl:py-8 gap-4 lg:gap-6 w-full max-w-[1400px] mx-auto">
        {/* Left: QR Code Panel */}
        <section className="w-full lg:w-[30%] flex flex-col gap-4 shrink-0">
        {/* Zone 1 — Player join QR (prominent) */}
        <div className="bg-surface-container-lowest rounded-xl p-4 lg:p-5 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant/30 relative">
          {urlInfo.playerJoinUrl ? (
            <QRCodeSVG
              value={urlInfo.playerJoinUrl}
              size={160}
              className="mb-3 h-[clamp(7.5rem,11vw,9rem)] w-[clamp(7.5rem,11vw,9rem)] opacity-90"
            />
          ) : (
            <div className="h-[clamp(7.5rem,11vw,9rem)] w-[clamp(7.5rem,11vw,9rem)] bg-on-surface rounded-lg p-4 grid grid-cols-4 grid-rows-4 gap-2 opacity-10 mb-3">
              <div className="bg-surface col-span-1 row-span-1"></div>
              <div className="bg-surface col-span-1 row-span-1"></div>
              <div className="bg-surface col-span-1 row-span-1"></div>
              <div className="bg-surface col-span-2 row-span-2"></div>
            </div>
          )}
          <h2 className="font-headline text-xl lg:text-2xl font-extrabold text-primary mb-1">Scan to Join!</h2>
          <p className="text-on-surface-variant max-w-xs mx-auto text-xs lg:text-sm font-medium text-center">Point your camera here to join the game on your phone.</p>
        </div>

        {/* Zone 2 — Manual fallback */}
        <div className="bg-secondary-container/30 rounded-xl px-4 py-3 lg:px-5 lg:py-4 flex flex-col items-center text-center border border-secondary/10">
          <p className="text-[11px] text-secondary font-bold uppercase tracking-widest mb-1">Or go to <span className="font-bold text-on-secondary-container">telestrations.com</span> and enter</p>
          <span className="font-headline text-2xl lg:text-3xl font-black tracking-widest text-on-secondary-container">{code}</span>
        </div>

        {/* Zone 3 — Host QR (blurred/hidden) */}
        {!phoneConnected ? (
          <div
            className="bg-surface-container-lowest rounded-xl p-4 lg:p-5 flex flex-col items-center justify-center text-center border-2 border-dashed border-outline-variant/30 cursor-pointer"
            onMouseEnter={(e) => (e.currentTarget.querySelector<HTMLDivElement>(".host-qr-inner")!.style.filter = "none")}
            onMouseLeave={(e) => (e.currentTarget.querySelector<HTMLDivElement>(".host-qr-inner")!.style.filter = "blur(8px)")}
          >
            <h2 className="font-headline text-lg lg:text-xl font-extrabold text-primary mb-1">Host Controls</h2>
            <p className="text-on-surface-variant max-w-xs mx-auto text-xs lg:text-sm font-medium text-center mb-4 lg:mb-5">Hover to reveal your controller QR.</p>
            <div className="host-qr-inner transition-all" style={{ filter: "blur(8px)" }}>
              {urlInfo.connectUrl ? (
                <QRCodeSVG
                  value={urlInfo.connectUrl}
                  size={148}
                  className="h-[clamp(6.5rem,9vw,8rem)] w-[clamp(6.5rem,9vw,8rem)]"
                />
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
        <section className="flex-grow min-h-0 flex flex-col gap-4 lg:gap-5 overflow-hidden max-w-full">
          <div className="flex justify-between items-end mb-1 border-b-2 border-outline-variant/20 pb-3">
            <h3 className="font-headline text-2xl lg:text-3xl font-black text-secondary tracking-tight">Joined Players <span className="text-primary">({playerList.length}/8)</span></h3>
            <span className="font-label text-on-surface-variant font-bold text-xs lg:text-sm tracking-widest uppercase">
            {8 - playerList.length > 0 ? `Waiting for up to ${8 - playerList.length} more` : "Room is full!"}
          </span>
        </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5 content-start auto-rows-fr">
          {playerList.map((p, index) => {
            const isHostPlayer = p.id === hostPlayerId;
            const initials = p.nickname.slice(0, 2).toUpperCase();

            // Varied tilt/rotation for players to match living doodle
            const rotation = index % 3 === 0 ? "transform -rotate-1" : index % 3 === 1 ? "transform rotate-2" : "transform -rotate-2";
            const bgRound = index % 3 === 0 ? "bg-secondary-container text-on-secondary-container sketch-shadow-secondary border border-secondary" : index % 3 === 1 ? "bg-primary-container text-on-primary-container border border-primary sketch-shadow-primary" : "bg-tertiary-container text-on-tertiary-container border border-tertiary sketch-shadow";
            const cardBg = "bg-surface-container-lowest";

            return (
                <div key={p.id} className={`${cardBg} p-4 lg:p-5 col-span-1 rounded-xl flex flex-col items-center gap-2 ${rotation} relative shadow-sm border border-outline-variant/10 transition-transform hover:scale-[1.03] min-h-[132px] lg:min-h-[148px] justify-center`}>
                <div className="relative">
                    <div className={`w-16 h-16 lg:w-18 lg:h-18 rounded-full flex items-center justify-center font-headline text-2xl lg:text-3xl font-bold ${bgRound}`}>
                    {initials}
                  </div>
                  {isHostPlayer && (
                    <div className="absolute -top-2 -right-2 bg-primary text-white text-[10px] px-2 py-1 rounded-full font-label uppercase font-bold tracking-widest shadow-sm">Host</div>
                  )}
                </div>
                  <span className="font-headline text-base lg:text-lg font-bold truncate w-full text-center text-on-surface mt-1">{p.nickname}</span>
                <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] absolute bottom-4"></div>
              </div>
            );
          })}

          {/* Empty Seats */}
          {Array.from({ length: Math.max(0, 8 - playerList.length) }).map((_, i) => (
              <div key={i} className="border-4 border-dashed border-outline-variant/20 p-4 lg:p-5 rounded-xl flex flex-col items-center justify-center gap-2 opacity-60 min-h-[132px] lg:min-h-[148px] bg-surface-container-lowest/50 group hover:border-outline-variant/40 transition-colors">
                <span className="material-symbols-outlined text-3xl lg:text-4xl text-outline-variant group-hover:scale-110 transition-transform">person_add</span>
              <span className="font-label text-xs uppercase tracking-wider font-bold text-outline-variant">Seat {playerList.length + i + 1}</span>
            </div>
          ))}
          </div>
        </section>

      </main>

      {/* Footer Settings (read-only) */}
      <footer className="bg-surface-container-lowest/95 backdrop-blur-md w-full z-50 rounded-t-[2rem] lg:rounded-t-[2.5rem] border-t-2 border-outline-variant/30 shadow-[0px_-20px_40px_rgba(49,46,41,0.08)] shrink-0">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center px-5 lg:px-10 py-3 lg:py-4 gap-4 md:gap-0">
          <div className="flex flex-col md:flex-row gap-5 lg:gap-8 items-center">
            <div className="flex flex-col items-center md:items-start">
              <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold mb-2">Game Settings</span>
              <div className="flex gap-4 lg:gap-6 items-center">
                <div className="flex flex-col items-center md:items-start">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Rounds</span>
                  <span className="font-headline text-xl lg:text-2xl font-extrabold text-on-surface">{numRounds}</span>
                </div>
                <div className="h-8 lg:h-10 w-px bg-outline-variant/30"></div>
                <div className="flex flex-col items-center md:items-start">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Scoring Mode</span>
                  <span className="font-headline text-lg lg:text-xl font-extrabold text-on-surface capitalize">{scoringMode}</span>
                </div>
              </div>
              <span className="text-[10px] text-outline-variant mt-1 font-label">Set on host phone</span>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:gap-8 w-full md:w-auto justify-between md:justify-end">
            <div className="flex flex-col items-center bg-secondary-container/30 px-5 py-2 rounded-xl border border-secondary/10">
              <span className="font-label text-[10px] font-bold text-secondary uppercase tracking-widest mb-0.5">Room Code</span>
              <span className="font-headline text-xl lg:text-2xl font-black tracking-widest text-on-secondary-container">{code}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";

interface DebugPlayer {
  playerId: string;
  nickname: string;
  isHost: boolean;
  screen: string;
}

interface SessionState {
  sessionId: string;
  roomCode: string;
  roomStatus: string;
  currentRound: number;
  numRounds: number;
  players: DebugPlayer[];
}

type DebugAction =
  | "start_game"
  | "submit_all_prompts"
  | "submit_all_drawings"
  | "submit_all_guesses"
  | "advance_reveal";

const ACTION_LABELS: Record<DebugAction, string> = {
  start_game: "Start Game",
  submit_all_prompts: "Submit All Prompts",
  submit_all_drawings: "Submit All Drawings",
  submit_all_guesses: "Submit All Guesses",
  advance_reveal: "Advance Reveal",
};

const ACTION_PHASES: Record<DebugAction, string[]> = {
  start_game: ["lobby"],
  submit_all_prompts: ["prompts"],
  submit_all_drawings: ["active"],
  submit_all_guesses: ["active"],
  advance_reveal: ["reveal"],
};

export function DebugDashboard() {
  const [playerCount, setPlayerCount] = useState(4);
  const [session, setSession] = useState<SessionState | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<DebugAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/debug/session/${sessionId}`);
    if (res.ok) {
      const data = (await res.json()) as SessionState;
      setSession(data);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      void fetchState(session.sessionId);
    }, 2000);
    return () => clearInterval(interval);
  }, [session, fetchState]);

  async function createSession() {
    setCreating(true);
    setError(null);
    const res = await fetch("/api/debug/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerCount }),
    });
    const data = (await res.json()) as { sessionId?: string; roomCode?: string; players?: DebugPlayer[]; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to create session");
      setCreating(false);
      return;
    }
    // Fetch full state to get screens
    if (data.sessionId) {
      await fetchState(data.sessionId);
    }
    setCreating(false);
  }

  async function performAction(action: DebugAction) {
    if (!session) return;
    setActionLoading(action);
    setError(null);
    const res = await fetch(`/api/debug/session/${session.sessionId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Action failed");
    } else {
      await fetchState(session.sessionId);
    }
    setActionLoading(null);
  }

  function isActionEnabled(action: DebugAction): boolean {
    if (!session) return false;
    return ACTION_PHASES[action].includes(session.roomStatus);
  }

  return (
    <main className="min-h-screen p-8 font-mono bg-gray-50">
      <h1 className="text-2xl font-black mb-6">🛠 Debug Dashboard</h1>

      {!session ? (
        <div className="flex items-center gap-4 mb-8">
          <label className="text-sm font-medium">
            Players:
            <select
              value={playerCount}
              onChange={(e) => setPlayerCount(Number(e.target.value))}
              className="ml-2 border rounded px-2 py-1 bg-white"
            >
              {[4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void createSession()}
            disabled={creating}
            className="px-4 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            {creating ? "Creating…" : "New Session"}
          </button>
        </div>
      ) : (
        <>
          {/* Room status bar */}
          <div className="mb-6 p-4 bg-white rounded-lg border">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Room</p>
            <div className="flex items-center gap-4 mb-2">
              <p className="text-3xl font-black tracking-widest">{session.roomCode}</p>
              <a
                href={`/room/${session.roomCode}/host`}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded border border-purple-300 text-purple-600 hover:bg-purple-50 transition-colors font-medium"
              >
                📺 Open Host View
              </a>
            </div>
            <div className="flex gap-4 text-sm text-gray-600">
              <span>
                Phase: <strong className="text-gray-900">{session.roomStatus}</strong>
              </span>
              <span>
                Round:{" "}
                <strong className="text-gray-900">
                  {session.currentRound}/{session.numRounds}
                </strong>
              </span>
            </div>
          </div>

          {/* Player cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
            {session.players.map((p) => (
              <div key={p.playerId} className="border rounded-lg p-3 bg-white flex flex-col gap-2">
                <div>
                  <p className="font-bold text-sm truncate">
                    {p.nickname}
                    {p.isHost && (
                      <span className="ml-1 text-xs text-blue-600 font-normal">(Host)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{p.screen}</p>
                </div>
                <a
                  href={`/api/debug/session/${session.sessionId}/as-player/${p.playerId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-center px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  Open as {p.nickname}
                </a>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(Object.keys(ACTION_LABELS) as DebugAction[]).map((action) => {
              const enabled = isActionEnabled(action);
              return (
                <button
                  key={action}
                  onClick={() => void performAction(action)}
                  disabled={!enabled || actionLoading !== null}
                  className="px-3 py-2 text-sm rounded border bg-white font-medium disabled:opacity-30 enabled:hover:bg-gray-50 transition-colors"
                >
                  {actionLoading === action ? "…" : ACTION_LABELS[action]}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => {
              setSession(null);
              setError(null);
            }}
            className="text-xs text-gray-400 underline hover:text-gray-600"
          >
            New Session
          </button>
        </>
      )}

      {error && (
        <p className="mt-4 text-red-600 text-sm border border-red-200 rounded p-2 bg-red-50">
          {error}
        </p>
      )}
    </main>
  );
}

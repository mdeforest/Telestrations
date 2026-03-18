"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!nickname.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nickname.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to create room"); setLoading(false); return; }
    router.push(`/room/${data.code}`);
  }

  async function handleJoin() {
    if (!nickname.trim() || !joinCode.trim()) return;
    setLoading(true);
    setError(null);
    const code = joinCode.trim().toUpperCase();
    const res = await fetch(`/api/rooms/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nickname.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to join room"); setLoading(false); return; }
    router.push(`/room/${code}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 gap-8">
      <h1 className="text-5xl font-black tracking-tight">Telestrations</h1>

      <div className="w-full max-w-xs flex flex-col gap-4">
        <input
          type="text"
          placeholder="Your nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          className="border rounded-xl px-4 py-3 text-lg w-full"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={!nickname.trim() || loading}
          className="w-full py-3 rounded-xl text-lg font-bold bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
        >
          Create Room
        </button>

        <div className="flex items-center gap-3 text-gray-400 text-sm">
          <hr className="flex-1" /> or join <hr className="flex-1" />
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={4}
            className="border rounded-xl px-4 py-3 text-lg w-28 uppercase tracking-widest font-mono"
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          />
          <button
            onClick={handleJoin}
            disabled={!nickname.trim() || !joinCode.trim() || loading}
            className="flex-1 py-3 rounded-xl text-lg font-bold bg-gray-800 text-white disabled:opacity-40 hover:bg-gray-900 transition-colors"
          >
            Join
          </button>
        </div>
      </div>
    </main>
  );
}

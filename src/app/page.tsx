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
    <main className="flex-grow flex flex-col items-center justify-center px-6 pt-24 pb-32 min-h-screen">
      <div className="text-center mb-12 relative">
        <div className="absolute -top-8 -left-8 opacity-20 transform -rotate-12">
          <span className="material-symbols-outlined text-7xl text-primary" data-icon="brush">brush</span>
        </div>
        <h2 className="font-headline text-6xl md:text-7xl font-extrabold text-primary tracking-tight mb-2">
            Telestrations
        </h2>
        <p className="font-label text-tertiary font-bold uppercase tracking-[0.2em] text-sm">The Visual Telephone Game</p>
      </div>

      <div className="relative w-full max-w-md">
        <div className="absolute inset-0 bg-surface-container-high rounded-lg paper-stack-1 shadow-sm"></div>
        <div className="absolute inset-0 bg-surface-container rounded-lg paper-stack-2 shadow-sm"></div>
        
        <div className="relative bg-surface-container-lowest p-8 md:p-10 rounded-lg shadow-[0px_20px_40px_rgba(49,46,41,0.08)]">
          <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
            
            <div className="space-y-2">
              <label className="font-label text-sm font-bold text-on-surface-variant ml-2 flex items-center gap-2" htmlFor="nickname">
                <span className="material-symbols-outlined text-lg" data-icon="face">face</span>
                NICKNAME
              </label>
              <input
                className="w-full bg-surface-container-low border-0 rounded-DEFAULT p-4 text-on-surface placeholder:text-outline-variant focus:ring-2 focus:ring-primary/20 transition-all focus:rotate-1"
                id="nickname"
                placeholder="Sketchy Artist..."
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>

            <button
              className="w-full bg-surface-container-low text-secondary font-headline font-bold text-lg py-4 rounded-xl border-2 border-dashed border-secondary/20 hover:bg-secondary/5 transition-colors flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
              onClick={handleCreate}
              disabled={!nickname.trim() || loading}
            >
              <span className="material-symbols-outlined" data-icon="add_circle">add_circle</span>
              Create Room
            </button>

            <div className="flex items-center gap-4">
              <div className="flex-1 border-t border-outline-variant/30"></div>
              <span className="font-label text-xs text-outline font-bold uppercase tracking-widest">or join</span>
              <div className="flex-1 border-t border-outline-variant/30"></div>
            </div>

            <div className="space-y-2">
              <label className="font-label text-sm font-bold text-on-surface-variant ml-2 flex items-center gap-2" htmlFor="room-code">
                <span className="material-symbols-outlined text-lg" data-icon="vpn_key">vpn_key</span>
                ROOM CODE
              </label>
              <div className="relative">
                <input 
                  className="w-full bg-secondary-container/30 border-0 rounded-DEFAULT p-4 text-on-surface font-label font-bold text-2xl tracking-[0.3em] uppercase placeholder:text-outline-variant focus:ring-2 focus:ring-secondary/20 transition-all focus:-rotate-1" 
                  id="room-code" 
                  placeholder="A B C D" 
                  type="text"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 pointer-events-none">
                  <span className="material-symbols-outlined" data-icon="edit">edit</span>
                </div>
              </div>
            </div>

            {error && <p className="text-sm font-body text-error font-medium bg-error-container/20 px-4 py-3 rounded-xl">{error}</p>}

            <div className="pt-4">
              <button
                className="group relative w-full bg-primary text-on-primary font-headline font-bold text-xl py-5 rounded-xl sketch-shadow-primary active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:active:translate-y-0 disabled:active:translate-x-0 disabled:active:sketch-shadow-primary disabled:active:scale-100"
                type="button"
                onClick={handleJoin}
                disabled={!nickname.trim() || !joinCode.trim() || loading}
              >
                Join Game
                <span className="material-symbols-outlined group-hover:translate-x-1 transition-transform" data-icon="arrow_forward">arrow_forward</span>
              </button>
            </div>
          </form>

          <div className="mt-8 flex items-start gap-3 p-4 bg-tertiary-container/20 rounded-DEFAULT">
            <span className="material-symbols-outlined text-tertiary" data-icon="lightbulb">lightbulb</span>
            <p className="text-xs text-on-tertiary-container leading-relaxed">
              <span className="font-bold">Pro Tip:</span> No talent required! The worse the drawing, the funnier the outcome.
            </p>
          </div>
        </div>
      </div>

      <div className="fixed bottom-24 left-10 opacity-10 pointer-events-none hidden lg:block">
        <span className="material-symbols-outlined text-9xl text-on-surface" data-icon="draw">draw</span>
      </div>
      <div className="fixed top-32 right-12 opacity-10 pointer-events-none hidden lg:block">
        <span className="material-symbols-outlined text-8xl text-on-surface" data-icon="gesture">gesture</span>
      </div>
    </main>
  );
}

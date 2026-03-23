"use client";

import { useEffect, useState } from "react";
import { debugFetch } from "@/lib/debug/debug-fetch";

interface PromptOption {
  id: string;
  text: string;
}

interface Props {
  roundId: string;
  /** Called once the player has submitted (or was already submitted on load). */
  onSelected?: () => void;
}

export function PromptSelectionScreen({ roundId, onSelected }: Props) {
  const [options, setOptions] = useState<PromptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch prompt options on mount; skip to waiting screen if already selected
  useEffect(() => {
    debugFetch(`/api/rounds/${roundId}/prompts`)
      .then((r) => r.json())
      .then((data: { options?: PromptOption[]; alreadySelected?: boolean }) => {
        if (data.alreadySelected) {
          setSelected(true);
          onSelected?.();
        } else {
          setOptions(data.options ?? []);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load prompts");
        setLoading(false);
      });
  }, [roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: the "active" reload is handled by the parent (LobbyPlayerList /
  // HostLobby) which always has a roomStatus subscription. No need to duplicate
  // it here.

  async function handleSelect(promptId: string) {
    setSubmitting(true);
    setError(null);

    try {
      const res = await debugFetch(`/api/rounds/${roundId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to submit");
        setSubmitting(false);
        return;
      }

      setSelected(true);
      onSelected?.();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

const STYLE_MAP = [
  {
    icon: "draw",
    shadow: "sketch-shadow-primary",
    rotate: "hover:-translate-y-1 hover:rotate-1",
    iconBgHover: "group-hover:bg-primary-container",
    iconBgDef: "bg-primary-container/20",
    iconColor: "text-primary"
  },
  {
    icon: "palette",
    shadow: "sketch-shadow-secondary",
    rotate: "hover:-translate-y-1 hover:-rotate-1",
    iconBgHover: "group-hover:bg-secondary-container",
    iconBgDef: "bg-secondary-container/20",
    iconColor: "text-secondary"
  },
  {
    icon: "brush",
    shadow: "sketch-shadow-tertiary",
    rotate: "hover:-translate-y-1 hover:rotate-2",
    iconBgHover: "group-hover:bg-tertiary-container",
    iconBgDef: "bg-tertiary-container/20",
    iconColor: "text-tertiary"
  }
];

  if (loading) {
    return (
      <main className="flex-grow flex flex-col items-center justify-center px-6 pt-12 max-w-2xl mx-auto w-full">
        <div className="w-24 h-24 bg-surface-container-low rounded-full flex items-center justify-center relative mb-8">
          <span className="material-symbols-outlined text-5xl text-primary animate-bounce">brush</span>
          <div className="absolute inset-0 rounded-full border-4 border-dashed border-primary/20 animate-spin" style={{ animationDuration: "10s" }}></div>
        </div>
        <h2 className="text-2xl font-bold font-headline">Loading prompts…</h2>
      </main>
    );
  }

  if (selected) {
    return (
      <main className="flex-grow flex flex-col items-center justify-center px-6 pt-12 pb-32 max-w-2xl mx-auto w-full">
        <div className="bg-tertiary-container/30 w-full p-8 rounded-[2rem] text-center mb-10 border border-tertiary/10 shadow-sm transform rotate-1">
          <span className="material-symbols-outlined text-tertiary text-6xl mb-4 animate-pulse">hourglass_top</span>
          <h2 className="font-headline text-3xl font-extrabold text-on-surface mb-2">Waiting for others</h2>
          <p className="font-body text-on-surface-variant max-w-sm mx-auto font-medium">
            Your prompt is locked in. The round begins once everyone has chosen.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-grow flex flex-col items-center px-6 py-12 pb-32 max-w-2xl mx-auto w-full">
      {/* Floating Sketch Background Decor */}
      <div className="fixed top-24 -left-12 opacity-5 pointer-events-none select-none hidden md:block">
        <span className="material-symbols-outlined text-[12rem]">gesture</span>
      </div>
      <div className="fixed bottom-32 -right-8 rotate-12 opacity-5 pointer-events-none select-none hidden md:block">
        <span className="material-symbols-outlined text-[10rem]">draw</span>
      </div>

      <div className="text-center mb-10 -rotate-1 relative z-10 text-balance">
        <span className="font-label text-secondary uppercase tracking-[0.2em] text-sm mb-2 block font-bold">Round Start</span>
        <h2 className="font-headline text-4xl md:text-5xl font-extrabold text-on-surface leading-tight">
          Choose your <span className="text-primary italic">prompt</span>
        </h2>
      </div>

      {error && <p className="mb-6 px-4 py-3 bg-error-container/20 text-error font-bold rounded-xl relative z-10">{error}</p>}

      <div className="w-full space-y-6 flex flex-col relative z-10">
        {options.map((opt, i) => {
          const config = STYLE_MAP[i % STYLE_MAP.length];
          return (
            <button
              key={opt.id}
              onClick={() => handleSelect(opt.id)}
              disabled={submitting}
              className={`group relative w-full text-left bg-surface-container-lowest p-6 sm:p-8 rounded-[1.5rem] border-2 border-transparent transition-all duration-200 ${config.rotate} active:translate-y-0 active:scale-[0.98] ${config.shadow} disabled:opacity-50 disabled:grayscale`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-headline text-2xl sm:text-3xl font-bold text-on-surface leading-tight">{opt.text}</h3>
                </div>
                <div className={`${config.iconBgDef} p-4 rounded-full ${config.iconBgHover} transition-colors hidden sm:block`}>
                  <span className={`material-symbols-outlined ${config.iconColor} scale-125`}>{config.icon}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}

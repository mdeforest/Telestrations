"use client";

import { useEffect, useState } from "react";
import { getAblyClient } from "@/lib/realtime/client";
import { channels } from "@/lib/realtime/channels";

interface PromptOption {
  id: string;
  text: string;
}

interface Props {
  code: string;
  roundId: string;
}

export function PromptSelectionScreen({ code, roundId }: Props) {
  const [options, setOptions] = useState<PromptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch prompt options on mount
  useEffect(() => {
    fetch(`/api/rounds/${roundId}/prompts`)
      .then((r) => r.json())
      .then((data: { options: PromptOption[] }) => {
        setOptions(data.options);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load prompts");
        setLoading(false);
      });
  }, [roundId]);

  // Subscribe to room status — navigate to game when all players selected
  useEffect(() => {
    const ably = getAblyClient();
    const channel = ably.channels.get(channels.roomStatus(code));

    channel.subscribe("room-status-changed", (msg) => {
      const { status } = msg.data as { status: string };
      if (status === "active") {
        // Full page reload to get the updated server-rendered game view
        window.location.reload();
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [code]);

  async function handleSelect(promptId: string) {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/rounds/${roundId}/prompt`, {
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
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-gray-400">Loading prompts…</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex flex-col items-center gap-6 py-12">
        <div className="text-4xl">⏳</div>
        <h2 className="text-2xl font-bold">Waiting for others…</h2>
        <p className="text-gray-500 text-center max-w-xs">
          Your prompt is locked in. The round begins once everyone has chosen.
        </p>
        <div className="flex gap-1 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm">
      <div>
        <h2 className="text-xl font-bold mb-1">Choose your prompt</h2>
        <p className="text-sm text-gray-500">
          Pick one — only you can see your choice.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-3">
        {options.map((opt) => (
          <li key={opt.id}>
            <button
              onClick={() => handleSelect(opt.id)}
              disabled={submitting}
              className="w-full text-left px-5 py-4 rounded-xl border-2 border-gray-200 font-medium text-lg hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {opt.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// @vitest-environment jsdom
import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/realtime/client", () => ({
  getAblyClient: vi.fn(() => ({
    channels: {
      get: vi.fn(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        presence: { enter: vi.fn(), leave: vi.fn() },
      })),
    },
  })),
}));

import { DrawingPhaseScreen } from "../DrawingPhaseScreen";

function renderDrawing(overrides: Partial<Parameters<typeof DrawingPhaseScreen>[0]> = {}) {
  const defaults = {
    code: "ABCDEF",
    roundId: "round-1",
    playerId: "player-1",
    timerStartedAt: null,
    players: [],
  };
  return render(<DrawingPhaseScreen {...defaults} {...overrides} />);
}

describe("DrawingPhaseScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-submits when the timer reaches zero", async () => {
    const fetchMock = vi.fn()
      // my-entry fetch returns entryInfo so the submit can proceed
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bookId: "book-1", passNumber: 1, alreadySubmitted: false, incomingContent: "a cat" }),
      })
      // POST /api/entries
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ allSubmitted: false }),
      });
    vi.stubGlobal("fetch", fetchMock);

    // timerStartedAt set to 121 seconds ago (1s of headroom) so the synchronous tick()
    // on mount computes remaining=0 and sets autoSubmit=true immediately.
    const timerStartedAt = new Date(Date.now() - 121_000).toISOString();
    renderDrawing({ timerStartedAt });

    // Wait for the my-entry fetch promise chain to resolve and set entryInfo.
    // Once entryInfo is set, triggerAutoSubmit flips true (autoSubmit && !!entryInfo),
    // DrawingCanvas fires onSubmit, and handleSubmit POSTs /api/entries.
    await waitFor(() => {
      // Transition to PlayerWaitingScreen (which shows "You're all set!")
      expect(screen.getByText(/you're all set/i)).toBeTruthy();
    });

    // Verify both fetches were called: my-entry + POST /api/entries
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

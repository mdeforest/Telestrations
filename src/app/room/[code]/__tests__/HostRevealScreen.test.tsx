// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/realtime/client", () => ({
  getAblyClient: vi.fn(() => ({
    channels: {
      get: vi.fn(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      })),
    },
  })),
}));

import { HostRevealScreen } from "../host/HostRevealScreen";

function renderHostReveal(
  overrides: Partial<Parameters<typeof HostRevealScreen>[0]> = {}
) {
  const defaults = {
    code: "ABCDEF",
    scoringMode: "friendly" as const,
    initialBookIndex: 0,
    initialEntryIndex: 0,
  };

  return render(<HostRevealScreen {...defaults} {...overrides} />);
}

describe("HostRevealScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'That's a Wrap!' and no tally button in friendly mode after reveal finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        books: [],
        revealBookIndex: 0,
        revealEntryIndex: 0,
        status: "finished",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHostReveal({ scoringMode: "friendly" });

    expect(await screen.findByText(/that's a wrap/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /tally votes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /show final scores/i })).toBeNull();
  });

  it("does not show the leaderboard in friendly mode even if scoring:complete arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        books: [],
        revealBookIndex: 0,
        revealEntryIndex: 0,
        status: "finished",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Capture the scoring:complete subscriber so we can fire it manually
    let scoringCompleteCallback: ((msg: { data: unknown }) => void) | null = null;
    const { getAblyClient } = await import("@/lib/realtime/client");
    (getAblyClient as ReturnType<typeof vi.fn>).mockReturnValue({
      channels: {
        get: vi.fn((channelName: string) => ({
          subscribe: vi.fn((event: string, cb: (msg: { data: unknown }) => void) => {
            if (channelName.includes("scoring")) {
              scoringCompleteCallback = cb;
            }
          }),
          unsubscribe: vi.fn(),
        })),
      },
    });

    renderHostReveal({ scoringMode: "friendly" });

    // Wait for wrap screen
    expect(await screen.findByText(/that's a wrap/i)).toBeTruthy();

    // Fire a stale scoring:complete event
    if (scoringCompleteCallback) {
      (scoringCompleteCallback as (msg: { data: unknown }) => void)({
        data: { leaderboard: [{ playerId: "p1", nickname: "Alice", totalPoints: 5 }] },
      });
    }

    // Leaderboard should NOT appear
    expect(screen.queryByText(/leaderboard/i)).toBeNull();
  });

  it("shows the tally button in competitive mode after reveal finishes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          books: [],
          revealBookIndex: 0,
          revealEntryIndex: 0,
          status: "finished",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          leaderboard: [{ playerId: "p1", nickname: "Alice", totalPoints: 5 }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderHostReveal({ scoringMode: "competitive" });

    const tallyButton = await screen.findByRole("button", { name: /show final scores/i });
    fireEvent.click(tallyButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/rooms/ABCDEF/tally", {
        method: "POST",
      });
    });

    expect(await screen.findByText(/leaderboard/i)).toBeTruthy();
  });
});

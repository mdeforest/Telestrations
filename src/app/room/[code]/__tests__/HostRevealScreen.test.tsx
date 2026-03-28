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

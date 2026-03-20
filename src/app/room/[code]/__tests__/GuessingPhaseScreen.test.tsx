// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Ably client used inside the component
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

import { GuessingPhaseScreen } from "../GuessingPhaseScreen";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STROKES = JSON.stringify([{ tool: "pen", points: [{ x: 0, y: 0 }], color: "#000", width: 4 }]);

function renderGuessing(overrides: Partial<Parameters<typeof GuessingPhaseScreen>[0]> = {}) {
  const defaults = {
    code: "ABCDEF",
    roundId: "round-1",
    playerId: "player-1",
    timerStartedAt: null,
    incomingDrawing: STROKES,
  };
  return render(<GuessingPhaseScreen {...defaults} {...overrides} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GuessingPhaseScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {}); // suppress canvas jsdom warning
  });

  it("renders a canvas replay of the incoming drawing", () => {
    renderGuessing();
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a text input for the guess", () => {
    renderGuessing();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders a submit button", () => {
    renderGuessing();
    expect(screen.getByRole("button", { name: /submit guess/i })).toBeTruthy();
  });

  it("disables submit when entryInfo is not loaded (fetch pending)", () => {
    // Don't mock fetch — it will remain pending, keeping entryInfo null
    renderGuessing();
    const btn = screen.getByRole("button", { name: /submit guess/i });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("shows 'Waiting for others' after a successful submission", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bookId: "book-1", passNumber: 2, alreadySubmitted: false, type: "guess" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ allSubmitted: false }),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderGuessing();

    // Type the guess first (input is always enabled before submitting)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a friendly cat" } });

    // Wait for entryInfo to load → button becomes enabled
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /submit guess/i });
      expect(btn.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: /submit guess/i }));

    await waitFor(() => {
      expect(screen.getByText(/waiting for others/i)).toBeTruthy();
    });

    vi.unstubAllGlobals();
  });

  it("submits the guess text to POST /api/entries with type 'guess'", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bookId: "book-1", passNumber: 2, alreadySubmitted: false, type: "guess" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ allSubmitted: false }),
      });
    vi.stubGlobal("fetch", fetchMock);

    renderGuessing();

    // Type first so the button becomes enabled once entryInfo loads
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a cat in a hat" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submit guess/i }).hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: /submit guess/i }));

    await waitFor(() => {
      const submitCall = fetchMock.mock.calls[1];
      const body = JSON.parse(submitCall[1].body);
      expect(body.type).toBe("guess");
      expect(body.content).toBe("a cat in a hat");
    });

    vi.unstubAllGlobals();
  });

  it("shows 'Waiting for others' immediately when alreadySubmitted is true on load", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bookId: "book-1", passNumber: 2, alreadySubmitted: true, type: "guess" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderGuessing();

    await waitFor(() => {
      expect(screen.getByText(/waiting for others/i)).toBeTruthy();
    });

    vi.unstubAllGlobals();
  });

  it("displays a countdown timer", () => {
    const timerStartedAt = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
    renderGuessing({ timerStartedAt });
    // Should show something like 0:55
    expect(screen.getByLabelText(/seconds remaining/i)).toBeTruthy();
  });
});

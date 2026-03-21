// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { debugFetch } from "../debug-fetch";

describe("debugFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    sessionStorage.clear();
  });

  it("calls fetch normally when no debugPlayerId in sessionStorage", async () => {
    await debugFetch("/api/test");
    expect(fetch).toHaveBeenCalledWith("/api/test", undefined);
  });

  it("adds X-Debug-Player-Id header when debugPlayerId is in sessionStorage", async () => {
    sessionStorage.setItem("debugPlayerId", "p42");
    await debugFetch("/api/test", { method: "POST" });
    expect(fetch).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      headers: { "X-Debug-Player-Id": "p42" },
    });
  });

  it("merges with existing headers", async () => {
    sessionStorage.setItem("debugPlayerId", "p42");
    await debugFetch("/api/test", {
      headers: { "Content-Type": "application/json" },
    });
    expect(fetch).toHaveBeenCalledWith("/api/test", {
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Player-Id": "p42",
      },
    });
  });
});

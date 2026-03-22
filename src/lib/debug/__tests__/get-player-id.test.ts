import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  headerGet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mocks.cookieGet }),
  headers: () => Promise.resolve({ get: mocks.headerGet }),
}));

import { getPlayerId } from "../get-player-id";

describe("getPlayerId", () => {
  const OLD_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.env as Record<string, string>).NODE_ENV = "development";
  });

  afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = OLD_ENV;
  });

  it("returns X-Debug-Player-Id header value in dev mode", async () => {
    mocks.headerGet.mockImplementation((name: string) =>
      name === "x-debug-player-id" ? "debug-p1" : null
    );
    const id = await getPlayerId();
    expect(id).toBe("debug-p1");
  });

  it("falls back to cookie when no debug header in dev mode", async () => {
    mocks.headerGet.mockReturnValue(null);
    mocks.cookieGet.mockReturnValue({ value: "cookie-p1" });
    const id = await getPlayerId();
    expect(id).toBe("cookie-p1");
  });

  it("returns undefined when neither header nor cookie present", async () => {
    mocks.headerGet.mockReturnValue(null);
    mocks.cookieGet.mockReturnValue(undefined);
    const id = await getPlayerId();
    expect(id).toBeUndefined();
  });

  it("ignores the debug header in production and uses cookie", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    mocks.headerGet.mockReturnValue("debug-p1");
    mocks.cookieGet.mockReturnValue({ value: "cookie-p1" });
    const id = await getPlayerId();
    expect(id).toBe("cookie-p1");
  });
});

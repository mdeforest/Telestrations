import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted shared mock state ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  castVote: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: mocks.cookieGet }),
}));

vi.mock("@/lib/game/vote-service", () => ({
  createVoteService: () => ({ castVote: mocks.castVote }),
  SelfVoteError: class SelfVoteError extends Error {
    constructor() { super("self vote"); this.name = "SelfVoteError"; }
  },
  EntryNotInBookError: class EntryNotInBookError extends Error {
    constructor() { super("entry not in book"); this.name = "EntryNotInBookError"; }
  },
}));

vi.mock("@/lib/db", () => ({ db: {} }));

// Import AFTER mocks
import { POST } from "../route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/votes", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_BODY = {
  bookId: "book-1",
  entryId: "entry-1",
  voteType: "favorite_sketch",
};

const VOTE_ROW = {
  id: "vote-1",
  bookId: "book-1",
  voterPlayerId: "player-1",
  entryId: "entry-1",
  voteType: "favorite_sketch",
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /api/votes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when playerId cookie is missing", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    const res = await POST(makeReq({ bookId: "book-1" })); // missing entryId + voteType
    expect(res.status).toBe(400);
  });

  it("returns 400 when voteType is invalid", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    const res = await POST(makeReq({ ...VALID_BODY, voteType: "wrong_type" }));
    expect(res.status).toBe(400);
  });

  it("returns 201 with the vote record on success", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    mocks.castVote.mockResolvedValue(VOTE_ROW);

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toMatchObject({ id: "vote-1", voteType: "favorite_sketch" });
  });

  it("calls castVote with correct arguments", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    mocks.castVote.mockResolvedValue(VOTE_ROW);

    await POST(makeReq(VALID_BODY));

    expect(mocks.castVote).toHaveBeenCalledWith(
      "book-1",
      "player-1",
      "entry-1",
      "favorite_sketch"
    );
  });

  it("returns 409 when the player votes for their own entry", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    const { SelfVoteError } = await import("@/lib/game/vote-service");
    mocks.castVote.mockRejectedValue(new SelfVoteError());

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
  });

  it("returns 404 when the entry does not belong to the book", async () => {
    mocks.cookieGet.mockReturnValue({ value: "player-1" });
    const { EntryNotInBookError } = await import("@/lib/game/vote-service");
    mocks.castVote.mockRejectedValue(new EntryNotInBookError());

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  createPromptService,
  PromptNotFoundError,
  AlreadySelectedError,
  BookNotFoundError,
} from "../prompt-service";

// ── Mock helpers ────────────────────────────────────────────────────────────

/**
 * Builds a select mock that returns responses in sequence.
 * Handles `select().from().where()` pattern.
 */
function makeSelectSequence(responses: unknown[]) {
  let callIdx = 0;
  return vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() =>
        Promise.resolve(responses[callIdx++] ?? [])
      ),
    }),
  }));
}

/**
 * Tracking update mock — records every `.set()` call for assertions.
 */
function makeTrackingUpdateMock() {
  const setCalls: Array<Record<string, unknown>> = [];
  const mock = vi.fn().mockReturnValue({
    set: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      setCalls.push(vals);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{}]),
        }),
      };
    }),
  });
  return { mock, setCalls };
}

// ── Test data ───────────────────────────────────────────────────────────────

const ROUND_ID = "round-1";
const PLAYER_ID = "player-1";
const PROMPT_ID = "prompt-1";
const ROOM_ID = "room-1";

const BOOK_UNSELECTED = {
  id: "book-1",
  roundId: ROUND_ID,
  ownerPlayerId: PLAYER_ID,
  originalPrompt: "",
};

const BOOK_ALREADY_SELECTED = {
  ...BOOK_UNSELECTED,
  originalPrompt: "Already chosen",
};

const ROUND_ROW = { id: ROUND_ID, roomId: ROOM_ID, roundNumber: 1 };
const PROMPT = { id: PROMPT_ID, text: "A sleeping cat" };

// ── selectPrompt tests ──────────────────────────────────────────────────────

describe("selectPrompt", () => {
  it("records the chosen prompt text in the player's book for the round", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    // Sequence: [book, prompt, count=1 (not all done)]
    const db = {
      select: makeSelectSequence([
        [BOOK_UNSELECTED],
        [PROMPT],
        [{ count: 1 }],
      ]),
      update: updateMock,
    };

    const service = createPromptService(db as never);
    await service.selectPrompt(ROUND_ID, PLAYER_ID, PROMPT_ID);

    expect(setCalls[0]?.originalPrompt).toBe("A sleeping cat");
  });

  it("returns allSelected: false when other players have not yet chosen", async () => {
    const { mock: updateMock } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [BOOK_UNSELECTED],
        [PROMPT],
        [{ count: 2 }], // 2 books still unselected
      ]),
      update: updateMock,
    };

    const service = createPromptService(db as never);
    const result = await service.selectPrompt(ROUND_ID, PLAYER_ID, PROMPT_ID);

    expect(result.allSelected).toBe(false);
  });

  it("returns allSelected: true and transitions room to active when last player selects", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    // Sequence: [book, prompt, count=0, round]
    const db = {
      select: makeSelectSequence([
        [BOOK_UNSELECTED],
        [PROMPT],
        [{ count: 0 }],
        [ROUND_ROW],
      ]),
      update: updateMock,
    };

    const service = createPromptService(db as never);
    const result = await service.selectPrompt(ROUND_ID, PLAYER_ID, PROMPT_ID);

    expect(result.allSelected).toBe(true);
    // Second update call sets room status
    expect(setCalls[1]?.status).toBe("active");
  });

  it("throws AlreadySelectedError when player has already chosen a prompt", async () => {
    const db = {
      select: makeSelectSequence([[BOOK_ALREADY_SELECTED]]),
      update: vi.fn(),
    };

    const service = createPromptService(db as never);
    await expect(
      service.selectPrompt(ROUND_ID, PLAYER_ID, PROMPT_ID)
    ).rejects.toThrow(AlreadySelectedError);
  });

  it("sets currentRound on the room when transitioning to active", async () => {
    const { mock: updateMock, setCalls } = makeTrackingUpdateMock();

    const db = {
      select: makeSelectSequence([
        [BOOK_UNSELECTED],
        [PROMPT],
        [{ count: 0 }],
        [ROUND_ROW], // roundNumber: 1
      ]),
      update: updateMock,
    };

    const service = createPromptService(db as never);
    await service.selectPrompt(ROUND_ID, PLAYER_ID, PROMPT_ID);

    // Second update (room) must include both status and currentRound
    expect(setCalls[1]).toMatchObject({ status: "active", currentRound: 1 });
  });

  it("throws BookNotFoundError when the player has no book in this round", async () => {
    const db = {
      select: makeSelectSequence([
        [], // no book found
      ]),
      update: vi.fn(),
    };

    const service = createPromptService(db as never);
    await expect(
      service.selectPrompt(ROUND_ID, "unknown-player", PROMPT_ID)
    ).rejects.toThrow(BookNotFoundError);
  });

  it("throws PromptNotFoundError when the given promptId does not exist", async () => {
    const db = {
      select: makeSelectSequence([
        [BOOK_UNSELECTED],
        [], // prompt not found
      ]),
      update: vi.fn(),
    };

    const service = createPromptService(db as never);
    await expect(
      service.selectPrompt(ROUND_ID, PLAYER_ID, "bad-id")
    ).rejects.toThrow(PromptNotFoundError);
  });
});

// ── getPromptOptions mock helper ────────────────────────────────────────────

/**
 * Builds a select mock for getPromptOptions.
 * Call sequence inside the service:
 *   1. select().from(books).where(...)  → player's book (check alreadySelected)
 *   2. select().from(prompts)           → full prompts pool (no .where)
 */
function makeGetPromptOptionsMock(
  bookResult: unknown[],
  promptPool: unknown[]
) {
  let fromCallCount = 0;
  return vi.fn().mockReturnValue({
    from: vi.fn().mockImplementation(() => {
      const call = fromCallCount++;
      if (call === 0) {
        return { where: vi.fn().mockResolvedValue(bookResult) };
      }
      return Promise.resolve(promptPool);
    }),
  });
}

// ── getPromptOptions tests ──────────────────────────────────────────────────

describe("getPromptOptions", () => {
  it("returns exactly 3 unique prompts from the pool", async () => {
    const promptPool = Array.from({ length: 10 }, (_, i) => ({
      id: `prompt-${i}`,
      text: `Prompt ${i}`,
    }));

    const db = { select: makeGetPromptOptionsMock([BOOK_UNSELECTED], promptPool) };

    const service = createPromptService(db as never);
    const result = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    expect(result.options).toHaveLength(3);
    expect(new Set(result.options.map((o) => o.id)).size).toBe(3);
  });

  it("returns all prompts when pool has fewer than 3", async () => {
    const tinyPool = [{ id: "p-0", text: "Only option" }, { id: "p-1", text: "Second option" }];

    const db = { select: makeGetPromptOptionsMock([BOOK_UNSELECTED], tinyPool) };

    const service = createPromptService(db as never);
    const { options } = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    expect(options).toHaveLength(2);
  });

  it("returns prompts with id and text fields", async () => {
    const promptPool = Array.from({ length: 5 }, (_, i) => ({
      id: `prompt-${i}`,
      text: `Prompt ${i}`,
    }));

    const db = { select: makeGetPromptOptionsMock([BOOK_UNSELECTED], promptPool) };

    const service = createPromptService(db as never);
    const { options } = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    for (const opt of options) {
      expect(opt).toHaveProperty("id");
      expect(opt).toHaveProperty("text");
    }
  });

  it("returns alreadySelected: false when player has not yet chosen", async () => {
    const db = { select: makeGetPromptOptionsMock([BOOK_UNSELECTED], [PROMPT]) };

    const service = createPromptService(db as never);
    const result = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    expect(result.alreadySelected).toBe(false);
  });

  it("returns alreadySelected: true when player has already chosen a prompt", async () => {
    const db = { select: makeGetPromptOptionsMock([BOOK_ALREADY_SELECTED], [PROMPT]) };

    const service = createPromptService(db as never);
    const result = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    expect(result.alreadySelected).toBe(true);
  });

  it("returns alreadySelected: false and still returns options when player has no book", async () => {
    const promptPool = [PROMPT, { id: "p-2", text: "Another" }, { id: "p-3", text: "Third" }];
    const db = { select: makeGetPromptOptionsMock([], promptPool) }; // no book found

    const service = createPromptService(db as never);
    const result = await service.getPromptOptions(ROUND_ID, "unknown-player");

    expect(result.alreadySelected).toBe(false);
    expect(result.options).toHaveLength(3);
  });
});

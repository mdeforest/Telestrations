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

const ROUND_ROW = { id: ROUND_ID, roomId: ROOM_ID };
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

// ── getPromptOptions tests ──────────────────────────────────────────────────

describe("getPromptOptions", () => {
  it("returns exactly 3 unique prompts from the pool", async () => {
    const promptPool = Array.from({ length: 10 }, (_, i) => ({
      id: `prompt-${i}`,
      text: `Prompt ${i}`,
    }));

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(promptPool),
      }),
    };

    const service = createPromptService(db as never);
    const result = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    expect(result.options).toHaveLength(3);
    const ids = result.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("returns all prompts when pool has fewer than 3", async () => {
    const tinyPool = [{ id: "p-0", text: "Only option" }, { id: "p-1", text: "Second option" }];

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(tinyPool),
      }),
    };

    const service = createPromptService(db as never);
    const { options } = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    expect(options).toHaveLength(2);
  });

  it("returns prompts with id and text fields", async () => {
    const promptPool = Array.from({ length: 5 }, (_, i) => ({
      id: `prompt-${i}`,
      text: `Prompt ${i}`,
    }));

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(promptPool),
      }),
    };

    const service = createPromptService(db as never);
    const { options } = await service.getPromptOptions(ROUND_ID, PLAYER_ID);

    for (const opt of options) {
      expect(opt).toHaveProperty("id");
      expect(opt).toHaveProperty("text");
    }
  });
});

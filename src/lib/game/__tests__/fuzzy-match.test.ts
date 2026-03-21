import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "../fuzzy-match";

describe("fuzzyMatch", () => {
  it("returns true for exact match", () => {
    expect(fuzzyMatch("cat", "cat")).toBe(true);
  });

  it("returns true for near-match with minor typo", () => {
    expect(fuzzyMatch("elefant", "elephant")).toBe(true);
  });

  it("returns false for completely wrong strings", () => {
    expect(fuzzyMatch("banana", "elephant")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("CAT", "cat")).toBe(true);
    expect(fuzzyMatch("Santa Claus", "santa claus")).toBe(true);
  });

  it("normalizes leading and trailing whitespace", () => {
    expect(fuzzyMatch("  cat  ", "cat")).toBe(true);
    expect(fuzzyMatch("cat", "  cat  ")).toBe(true);
  });

  it("returns true for santa claus vs santa clause (classic near-match)", () => {
    expect(fuzzyMatch("santa claus", "santa clause")).toBe(true);
  });

  it("returns false for completely different short strings", () => {
    expect(fuzzyMatch("dog", "cat")).toBe(false);
  });

  it("returns true for empty string vs empty string", () => {
    expect(fuzzyMatch("", "")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { chainRouter, chainLength, entryType } from "../chain-router";

describe("chainRouter", () => {
  describe("even player count (N=4)", () => {
    it("routes all passes for seat 0", () => {
      // Even N: (ownerSeat + passNumber - 1) % N
      // Owner draws their own book on pass 1
      expect(chainRouter(0, 1, 4)).toBe(0);
      expect(chainRouter(0, 2, 4)).toBe(1);
      expect(chainRouter(0, 3, 4)).toBe(2);
      expect(chainRouter(0, 4, 4)).toBe(3);
    });

    it("routes all passes for seat 3 (last seat, wraps correctly)", () => {
      expect(chainRouter(3, 1, 4)).toBe(3);
      expect(chainRouter(3, 2, 4)).toBe(0);
      expect(chainRouter(3, 3, 4)).toBe(1);
      expect(chainRouter(3, 4, 4)).toBe(2);
    });
  });

  describe("odd player count (N=5)", () => {
    it("routes all passes for seat 0", () => {
      // Odd N: (ownerSeat + passNumber) % N
      // Owner does NOT draw; chain starts at next seat
      expect(chainRouter(0, 1, 5)).toBe(1);
      expect(chainRouter(0, 2, 5)).toBe(2);
      expect(chainRouter(0, 3, 5)).toBe(3);
      expect(chainRouter(0, 4, 5)).toBe(4);
    });

    it("routes all passes for seat 4 (last seat, wraps correctly)", () => {
      expect(chainRouter(4, 1, 5)).toBe(0);
      expect(chainRouter(4, 2, 5)).toBe(1);
      expect(chainRouter(4, 3, 5)).toBe(2);
      expect(chainRouter(4, 4, 5)).toBe(3);
    });

    it("routes all passes for seat 3", () => {
      expect(chainRouter(3, 1, 5)).toBe(4);
      expect(chainRouter(3, 2, 5)).toBe(0);
      expect(chainRouter(3, 3, 5)).toBe(1);
      expect(chainRouter(3, 4, 5)).toBe(2);
    });
  });

  describe("full coverage for all seats", () => {
    it("every (ownerSeat, passNumber) pair maps to a unique seat within a round for N=4", () => {
      const N = 4;
      for (let owner = 0; owner < N; owner++) {
        const authorSeats = Array.from({ length: N }, (_, i) =>
          chainRouter(owner, i + 1, N)
        );
        // Each seat appears exactly once per book
        expect(new Set(authorSeats).size).toBe(N);
      }
    });

    it("every (ownerSeat, passNumber) pair maps to a unique seat within a round for N=5", () => {
      const N = 5;
      const chainLength = N - 1;
      for (let owner = 0; owner < N; owner++) {
        const authorSeats = Array.from({ length: chainLength }, (_, i) =>
          chainRouter(owner, i + 1, N)
        );
        // Each non-owner seat appears exactly once per book
        expect(new Set(authorSeats).size).toBe(chainLength);
        // Owner never appears in their own chain (odd N)
        expect(authorSeats).not.toContain(owner);
      }
    });

    it("handles player counts 4–12 without throwing", () => {
      for (let N = 4; N <= 12; N++) {
        const len = chainLength(N);
        for (let owner = 0; owner < N; owner++) {
          for (let pass = 1; pass <= len; pass++) {
            const seat = chainRouter(owner, pass, N);
            expect(seat).toBeGreaterThanOrEqual(0);
            expect(seat).toBeLessThan(N);
          }
        }
      }
    });
  });
});

describe("chainLength", () => {
  it("returns N for even player counts", () => {
    expect(chainLength(4)).toBe(4);
    expect(chainLength(6)).toBe(6);
    expect(chainLength(8)).toBe(8);
    expect(chainLength(12)).toBe(12);
  });

  it("returns N-1 for odd player counts", () => {
    expect(chainLength(5)).toBe(4);
    expect(chainLength(7)).toBe(6);
    expect(chainLength(9)).toBe(8);
    expect(chainLength(11)).toBe(10);
  });
});

describe("entryType", () => {
  it("returns drawing for odd pass numbers and guess for even", () => {
    expect(entryType(1)).toBe("drawing");
    expect(entryType(2)).toBe("guess");
    expect(entryType(3)).toBe("drawing");
    expect(entryType(4)).toBe("guess");
    expect(entryType(5)).toBe("drawing");
    expect(entryType(6)).toBe("guess");
  });

  it("final entry is always a guess for all player counts 4–12 (even chain ends at N, odd at N-1, both even)", () => {
    for (let N = 4; N <= 12; N++) {
      const finalPass = chainLength(N); // N for even N, N-1 for odd N — both are always even
      expect(entryType(finalPass)).toBe("guess");
    }
  });
});

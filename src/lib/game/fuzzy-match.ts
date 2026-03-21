function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

const THRESHOLD = 0.25;

export function fuzzyMatch(guess: string, reference: string): boolean {
  const g = guess.trim().toLowerCase();
  const r = reference.trim().toLowerCase();
  if (g === r) return true;
  const maxLen = Math.max(g.length, r.length);
  if (maxLen === 0) return true;
  const distance = levenshtein(g, r);
  return distance / maxLen <= THRESHOLD;
}

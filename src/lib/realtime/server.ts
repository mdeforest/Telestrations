import Ably from "ably";

// Server-side Ably REST client — used in API route handlers to publish events
// after mutating DB state (e.g., advance round → publish to round:pass channel).

let rest: Ably.Rest | null = null;

export function getAblyRest(): Ably.Rest {
  if (!rest) {
    rest = new Ably.Rest({ key: process.env.ABLY_API_KEY! });
  }
  return rest;
}

import Ably from "ably";

// Browser-side Ably client — uses token auth so the API key is never exposed.
// Token endpoint: /api/ably/token

let client: Ably.Realtime | null = null;

export function getAblyClient(): Ably.Realtime {
  if (!client) {
    client = new Ably.Realtime({
      authUrl: "/api/ably/token",
      authMethod: "POST",
    });
  }
  return client;
}

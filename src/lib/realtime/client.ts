import Ably from "ably";

// Browser-side Ably client — uses token auth so the API key is never exposed.
// Token endpoint: /api/ably/token

let client: Ably.Realtime | null = null;

export function resetAblyClient(): void {
  if (client) {
    client.close();
    client = null;
  }
}

export function getAblyClient(): Ably.Realtime {
  if (!client) {
    const debugPlayerId =
      typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("debugPlayerId")
        : null;

    client = new Ably.Realtime({
      authUrl: "/api/ably/token",
      authMethod: "POST",
      ...(debugPlayerId
        ? { authHeaders: { "X-Debug-Player-Id": debugPlayerId } }
        : {}),
    });
  }
  return client;
}

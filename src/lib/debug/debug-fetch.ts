/**
 * Drop-in replacement for `fetch` that injects an `X-Debug-Player-Id` header
 * when the debug tool has stored a player ID in sessionStorage.
 *
 * Used by all player-facing screen components so that a single tab can
 * impersonate a specific player without relying on the shared browser cookie.
 */
export function debugFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const debugPlayerId =
    typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("debugPlayerId")
      : null;

  if (!debugPlayerId) {
    return fetch(input, init);
  }

  return fetch(input, {
    ...init,
    headers: {
      ...init?.headers,
      "X-Debug-Player-Id": debugPlayerId,
    },
  });
}

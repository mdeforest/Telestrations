import { cookies, headers } from "next/headers";

/**
 * Reads the current player's ID from the request context.
 *
 * In development, checks the `X-Debug-Player-Id` request header first — this
 * allows the debug tool to impersonate specific players per-tab using
 * sessionStorage + a fetch wrapper, bypassing the shared browser cookie.
 *
 * In production (or when the header is absent), falls back to the `playerId`
 * cookie as normal.
 */
export async function getPlayerId(): Promise<string | undefined> {
  if (process.env.NODE_ENV !== "production") {
    const headersList = await headers();
    const debugId = headersList.get("x-debug-player-id");
    if (debugId) return debugId;
  }

  const cookieStore = await cookies();
  return cookieStore.get("playerId")?.value;
}

import { getAblyRest } from "@/lib/realtime/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Issues short-lived Ably tokens for browser clients.
// The browser client calls this endpoint on connect instead of using the raw API key.
// clientId is set to the player's ID (from cookie) so presence works.

export async function POST() {
  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  const ably = getAblyRest();
  const tokenRequest = await ably.auth.createTokenRequest({
    capability: { "*": ["subscribe", "publish", "presence"] },
    clientId: playerId ?? "anonymous",
    ttl: 3600 * 1000, // 1 hour
  });
  return NextResponse.json(tokenRequest);
}

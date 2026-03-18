import { getAblyRest } from "@/lib/realtime/server";
import { NextResponse } from "next/server";

// Issues short-lived Ably tokens for browser clients.
// The browser client calls this endpoint on connect instead of using the raw API key.

export async function POST() {
  const ably = getAblyRest();
  const tokenRequest = await ably.auth.createTokenRequest({
    capability: { "*": ["subscribe", "publish"] },
    ttl: 3600 * 1000, // 1 hour
  });
  return NextResponse.json(tokenRequest);
}

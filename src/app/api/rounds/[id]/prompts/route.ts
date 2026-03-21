import { NextRequest, NextResponse } from "next/server";
import { getPlayerId } from "@/lib/debug/get-player-id";
import { db } from "@/lib/db";
import { createPromptService } from "@/lib/game/prompt-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roundId } = await params;

  const playerId = await getPlayerId();

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createPromptService(db);
  const result = await service.getPromptOptions(roundId, playerId);

  return NextResponse.json(result);
}

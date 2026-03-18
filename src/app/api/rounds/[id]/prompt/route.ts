import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  createPromptService,
  AlreadySelectedError,
  PromptNotFoundError,
} from "@/lib/game/prompt-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roundId } = await params;
  const body = await req.json().catch(() => ({}));

  const promptId = typeof body.promptId === "string" ? body.promptId : undefined;
  if (!promptId) {
    return NextResponse.json({ error: "promptId is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createPromptService(db);

  try {
    const result = await service.selectPrompt(roundId, playerId, promptId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AlreadySelectedError) {
      return NextResponse.json({ error: "Prompt already selected" }, { status: 409 });
    }
    if (err instanceof PromptNotFoundError) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }
    throw err;
  }
}

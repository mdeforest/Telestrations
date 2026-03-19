import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { books, rounds, rooms } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  createPromptService,
  AlreadySelectedError,
  BookNotFoundError,
  PromptNotFoundError,
} from "@/lib/game/prompt-service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

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

    // Fetch room code for Ably channel routing
    const [roundInfo] = await db
      .select({ code: rooms.code })
      .from(rounds)
      .innerJoin(rooms, eq(rounds.roomId, rooms.id))
      .where(eq(rounds.id, roundId));

    if (roundInfo) {
      // Count selected vs total for the host display
      const [counts] = await db
        .select({
          total: sql<number>`cast(count(*) as integer)`,
          selected: sql<number>`cast(count(*) filter (where original_prompt != '') as integer)`,
        })
        .from(books)
        .where(eq(books.roundId, roundId));

      const ably = getAblyRest();

      await ably.channels
        .get(channels.roomPrompts(roundInfo.code))
        .publish("prompt-selected", {
          selectedCount: counts.selected,
          totalCount: counts.total,
        });

      if (result.allSelected) {
        // Fetch the timer start time to broadcast to clients
        const [updatedRound] = await db
          .select({ timerStartedAt: rounds.timerStartedAt })
          .from(rounds)
          .where(eq(rounds.id, roundId));

        await ably.channels
          .get(channels.roomStatus(roundInfo.code))
          .publish("room-status-changed", {
            status: "active",
            roundId,
            timerStartedAt: updatedRound?.timerStartedAt?.toISOString() ?? null,
          });
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BookNotFoundError) {
      return NextResponse.json({ error: "Player not found in this round" }, { status: 404 });
    }
    if (err instanceof AlreadySelectedError) {
      return NextResponse.json({ error: "Prompt already selected" }, { status: 409 });
    }
    if (err instanceof PromptNotFoundError) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }
    throw err;
  }
}

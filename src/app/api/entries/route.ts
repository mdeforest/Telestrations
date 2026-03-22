import { NextRequest, NextResponse } from "next/server";
import { getPlayerId } from "@/lib/debug/get-player-id";
import { db } from "@/lib/db";
import { books, rounds, rooms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createEntryService,
  WrongAuthorError,
  AlreadySubmittedError,
  ContentTooLargeError,
  EntryNotFoundError,
} from "@/lib/game/entry-service";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function POST(req: NextRequest) {
  const playerId = await getPlayerId();

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entryType = (body as Record<string, unknown>).type;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).bookId !== "string" ||
    typeof (body as Record<string, unknown>).passNumber !== "number" ||
    (entryType !== "drawing" && entryType !== "guess") ||
    typeof (body as Record<string, unknown>).content !== "string"
  ) {
    return NextResponse.json(
      { error: "bookId, passNumber, type ('drawing' or 'guess'), and content are required" },
      { status: 400 }
    );
  }

  const { bookId, passNumber, content } = body as {
    bookId: string;
    passNumber: number;
    content: string;
  };

  const service = createEntryService(db);

  // Resolve scoringMode via book → round → room (needed for fuzzy scoring in competitive mode)
  const [scoringInfo] = await db
    .select({ scoringMode: rooms.scoringMode })
    .from(books)
    .innerJoin(rounds, eq(books.roundId, rounds.id))
    .innerJoin(rooms, eq(rounds.roomId, rooms.id))
    .where(eq(books.id, bookId));

  const scoringMode = scoringInfo?.scoringMode;

  try {
    const result = await service.submitEntry(bookId, passNumber, playerId, content, scoringMode);

    if (result.allSubmitted) {
      // Look up the room so we can publish Ably events
      const [book] = await db.select().from(books).where(eq(books.id, bookId));
      if (book) {
        const [round] = await db
          .select()
          .from(rounds)
          .where(eq(rounds.id, book.roundId));
        if (round) {
          const [room] = await db
            .select()
            .from(rooms)
            .where(eq(rooms.id, round.roomId));

          if (room) {
            if (result.roundComplete) {
              // Round done — always transition to reveal so each round has its own reveal phase.
              // The reveal service handles advancing to the next round's prompts when applicable.
              await db
                .update(rooms)
                .set({ status: "reveal" })
                .where(eq(rooms.id, room.id));

              await getAblyRest()
                .channels.get(channels.roomStatus(room.code))
                .publish("room-status-changed", { status: "reveal" });
            } else {
              // More passes remain — signal clients to move to next pass
              await getAblyRest()
                .channels.get(channels.roundPass(room.code))
                .publish("pass-advanced", {
                  newPass: round.currentPass,
                });
            }
          }
        }
      }
    }

    return NextResponse.json({ allSubmitted: result.allSubmitted, roundComplete: result.roundComplete });
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    if (err instanceof WrongAuthorError) {
      return NextResponse.json(
        { error: "You are not the author of this entry" },
        { status: 403 }
      );
    }
    if (err instanceof AlreadySubmittedError) {
      return NextResponse.json(
        { error: "Entry already submitted" },
        { status: 409 }
      );
    }
    if (err instanceof ContentTooLargeError) {
      return NextResponse.json(
        { error: "Drawing content exceeds 500KB limit" },
        { status: 413 }
      );
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  // Timer expiry endpoint — called by a server-side scheduled job or Ably webhook
  const playerId = await getPlayerId();

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).roundId !== "string"
  ) {
    return NextResponse.json({ error: "roundId is required" }, { status: 400 });
  }

  const { roundId } = body as { roundId: string };

  const service = createEntryService(db);
  const expireResult = await service.expirePass(roundId);

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (round) {
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, round.roomId));

    if (room) {
      if (expireResult.roundComplete) {
        // Round done — always transition to reveal.
        // The reveal service handles advancing to the next round's prompts.
        await db
          .update(rooms)
          .set({ status: "reveal" })
          .where(eq(rooms.id, room.id));

        await getAblyRest()
          .channels.get(channels.roomStatus(room.code))
          .publish("room-status-changed", { status: "reveal" });
      } else {
        await getAblyRest()
          .channels.get(channels.roundPass(room.code))
          .publish("pass-advanced", {
            newPass: round.currentPass,
            timedOut: true,
          });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

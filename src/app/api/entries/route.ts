import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { books, rounds } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
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
  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

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
    typeof (body as Record<string, unknown>).bookId !== "string" ||
    typeof (body as Record<string, unknown>).passNumber !== "number" ||
    (body as Record<string, unknown>).type !== "drawing" ||
    typeof (body as Record<string, unknown>).content !== "string"
  ) {
    return NextResponse.json(
      { error: "bookId, passNumber, type ('drawing'), and content are required" },
      { status: 400 }
    );
  }

  const { bookId, passNumber, content } = body as {
    bookId: string;
    passNumber: number;
    content: string;
  };

  const service = createEntryService(db);

  try {
    const result = await service.submitEntry(bookId, passNumber, playerId, content);

    if (result.allSubmitted) {
      // Look up the room code so we can publish to the scoped channel
      const [book] = await db.select().from(books).where(eq(books.id, bookId));
      if (book) {
        const [round] = await db
          .select()
          .from(rounds)
          .where(eq(rounds.id, book.roundId));
        if (round) {
          // Look up the room to get the code
          const { rooms } = await import("@/lib/db/schema");
          const [room] = await db
            .select()
            .from(rooms)
            .where(eq(rooms.id, round.roomId));

          if (room) {
            await getAblyRest()
              .channels.get(channels.roundPass(room.code))
              .publish("pass-advanced", {
                newPass: round.currentPass,
              });
          }
        }
      }
    }

    return NextResponse.json({ allSubmitted: result.allSubmitted });
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
  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

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
  await service.expirePass(roundId);

  // Publish pass-advanced event so clients know to move on
  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (round) {
    const { rooms } = await import("@/lib/db/schema");
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, round.roomId)));

    if (room) {
      await getAblyRest()
        .channels.get(channels.roundPass(room.code))
        .publish("pass-advanced", {
          newPass: round.currentPass,
          timedOut: true,
        });
    }
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { rooms, players, books, rounds, entries } from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, code.toUpperCase()));

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Fetch all rounds for this room ordered by roundNumber
  const roomRounds = await db
    .select()
    .from(rounds)
    .where(eq(rounds.roomId, room.id))
    .orderBy(asc(rounds.roundNumber));

  const roundIds = roomRounds.map((r) => r.id);

  if (roundIds.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Fetch all books with their owner player, ordered by round then seat
  const bookRows = await db
    .select({
      id: books.id,
      roundId: books.roundId,
      ownerPlayerId: books.ownerPlayerId,
      originalPrompt: books.originalPrompt,
      ownerNickname: players.nickname,
      ownerSeatOrder: players.seatOrder,
      roundNumber: rounds.roundNumber,
    })
    .from(books)
    .innerJoin(players, eq(books.ownerPlayerId, players.id))
    .innerJoin(rounds, eq(books.roundId, rounds.id))
    .where(inArray(books.roundId, roundIds))
    .orderBy(asc(rounds.roundNumber), asc(players.seatOrder));

  const bookIds = bookRows.map((b) => b.id);

  // Fetch all entries for these books
  const entryRows = bookIds.length > 0
    ? await db
        .select({
          id: entries.id,
          bookId: entries.bookId,
          passNumber: entries.passNumber,
          type: entries.type,
          content: entries.content,
          authorPlayerId: entries.authorPlayerId,
          authorNickname: players.nickname,
        })
        .from(entries)
        .innerJoin(players, eq(entries.authorPlayerId, players.id))
        .where(inArray(entries.bookId, bookIds))
        .orderBy(asc(entries.passNumber))
    : [];

  // Group entries by book
  const entriesByBook = entryRows.reduce<Record<string, typeof entryRows>>(
    (acc, e) => {
      (acc[e.bookId] ??= []).push(e);
      return acc;
    },
    {}
  );

  const result = bookRows.map((b) => ({
    id: b.id,
    originalPrompt: b.originalPrompt,
    ownerPlayerId: b.ownerPlayerId,
    ownerNickname: b.ownerNickname,
    roundNumber: b.roundNumber,
    entries: (entriesByBook[b.id] ?? []).sort((a, b) => a.passNumber - b.passNumber),
  }));

  return NextResponse.json({
    books: result,
    revealBookIndex: room.revealBookIndex,
    revealEntryIndex: room.revealEntryIndex,
    status: room.status,
  });
}

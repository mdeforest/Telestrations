import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { books, entries, rounds } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * GET /api/rounds/[id]/my-entry
 *
 * Returns the calling player's entry for the round's current pass.
 * Used by the DrawingPhaseScreen to know which bookId + passNumber to submit to.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roundId } = await params;

  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }

  // Single join query: entries for this player + pass, in a book that belongs to this round
  const [myEntry] = await db
    .select({
      bookId: entries.bookId,
      passNumber: entries.passNumber,
      submittedAt: entries.submittedAt,
    })
    .from(entries)
    .innerJoin(books, eq(entries.bookId, books.id))
    .where(
      and(
        eq(books.roundId, roundId),
        eq(entries.passNumber, round.currentPass),
        eq(entries.authorPlayerId, playerId)
      )
    );

  if (!myEntry) {
    return NextResponse.json({ error: "No entry found for this player" }, { status: 404 });
  }

  return NextResponse.json({
    bookId: myEntry.bookId,
    passNumber: myEntry.passNumber,
    alreadySubmitted: myEntry.submittedAt !== null,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getPlayerId } from "@/lib/debug/get-player-id";
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

  const playerId = await getPlayerId();

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
      type: entries.type,
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

  // Load the content the player needs to act on:
  // - guess pass: the previous drawing to guess from
  // - drawing pass 1: the book's original prompt (the word to draw)
  // - drawing pass 3+: the previous guess (the word to draw)
  let incomingContent: string | null = null;
  if (myEntry.type === "guess" && myEntry.passNumber > 1) {
    const [prevEntry] = await db
      .select({ content: entries.content })
      .from(entries)
      .where(
        and(
          eq(entries.bookId, myEntry.bookId),
          eq(entries.passNumber, myEntry.passNumber - 1)
        )
      );
    incomingContent = prevEntry?.content ?? null;
  } else if (myEntry.type === "drawing") {
    if (myEntry.passNumber === 1) {
      const [book] = await db
        .select({ originalPrompt: books.originalPrompt })
        .from(books)
        .where(eq(books.id, myEntry.bookId));
      incomingContent = book?.originalPrompt ?? null;
    } else {
      const [prevEntry] = await db
        .select({ content: entries.content })
        .from(entries)
        .where(
          and(
            eq(entries.bookId, myEntry.bookId),
            eq(entries.passNumber, myEntry.passNumber - 1)
          )
        );
      incomingContent = prevEntry?.content ?? null;
    }
  }

  return NextResponse.json({
    bookId: myEntry.bookId,
    passNumber: myEntry.passNumber,
    alreadySubmitted: myEntry.submittedAt !== null,
    type: myEntry.type,
    incomingContent,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { books, entries, players, rounds } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

/**
 * GET /api/rounds/[id]/drawing-status
 *
 * Returns the current drawing-phase state for a round:
 * - timerStartedAt: ISO string or null
 * - currentPass: which pass is active
 * - pendingNicknames: players who haven't submitted for the current pass
 * - disconnectedNicknames: players currently marked as disconnected
 *
 * Used by both the player "Waiting for others" screen and the host countdown view.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: roundId } = await params;

  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  if (!round) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }

  // Find all books in this round, then all entries for the current pass
  const roundBooks = await db
    .select({ id: books.id, ownerPlayerId: books.ownerPlayerId })
    .from(books)
    .where(eq(books.roundId, roundId));

  const bookIds = roundBooks.map((b) => b.id);

  // Entries for current pass that haven't been submitted yet, scoped to this round's books
  const pendingEntries = bookIds.length > 0
    ? await db
        .select({ authorPlayerId: entries.authorPlayerId })
        .from(entries)
        .where(
          and(
            inArray(entries.bookId, bookIds),
            eq(entries.passNumber, round.currentPass),
            isNull(entries.submittedAt)
          )
        )
    : [];

  const pendingPlayerIds = new Set(pendingEntries.map((e) => e.authorPlayerId));

  // Load all players in the room to get nicknames + disconnected status
  const allPlayers = await db
    .select({ id: players.id, nickname: players.nickname, isConnected: players.isConnected })
    .from(players)
    .where(eq(players.roomId, round.roomId));

  const pendingNicknames = allPlayers
    .filter((p) => pendingPlayerIds.has(p.id))
    .map((p) => p.nickname);

  const disconnectedNicknames = allPlayers
    .filter((p) => !p.isConnected)
    .map((p) => p.nickname);

  return NextResponse.json({
    timerStartedAt: round.timerStartedAt?.toISOString() ?? null,
    currentPass: round.currentPass,
    pendingNicknames,
    disconnectedNicknames,
  });
}

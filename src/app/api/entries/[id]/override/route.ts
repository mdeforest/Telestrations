import { NextRequest, NextResponse } from "next/server";
import { getPlayerId } from "@/lib/debug/get-player-id";
import { db } from "@/lib/db";
import { books, entries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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
    typeof (body as Record<string, unknown>).correct !== "boolean"
  ) {
    return NextResponse.json(
      { error: "'correct' (boolean) is required" },
      { status: 400 }
    );
  }

  const { correct } = body as { correct: boolean };

  // Load entry
  const [entry] = await db
    .select()
    .from(entries)
    .where(eq(entries.id, id));

  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Load book to verify ownership
  const [book] = await db
    .select()
    .from(books)
    .where(eq(books.id, entry.bookId));

  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  if (book.ownerPlayerId !== playerId) {
    return NextResponse.json(
      { error: "Only the book owner can override the fuzzy result" },
      { status: 403 }
    );
  }

  const [updated] = await db
    .update(entries)
    .set({ ownerOverride: correct })
    .where(eq(entries.id, id))
    .returning();

  return NextResponse.json({ entry: updated });
}

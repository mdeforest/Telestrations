import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  createVoteService,
  SelfVoteError,
  EntryNotInBookError,
} from "@/lib/game/vote-service";

const VALID_VOTE_TYPES = ["favorite_sketch", "favorite_guess"] as const;
type VoteType = (typeof VALID_VOTE_TYPES)[number];

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const playerId = cookieStore.get("playerId")?.value;

  if (!playerId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { bookId, entryId, voteType } = body;

  if (
    typeof bookId !== "string" ||
    typeof entryId !== "string" ||
    typeof voteType !== "string" ||
    !VALID_VOTE_TYPES.includes(voteType as VoteType)
  ) {
    return NextResponse.json(
      { error: "bookId, entryId, and a valid voteType are required" },
      { status: 400 }
    );
  }

  const service = createVoteService(db);

  try {
    const vote = await service.castVote(bookId, playerId, entryId, voteType as VoteType);
    return NextResponse.json(vote, { status: 201 });
  } catch (err) {
    if (err instanceof SelfVoteError) {
      return NextResponse.json(
        { error: "Players cannot vote for their own entries" },
        { status: 409 }
      );
    }
    if (err instanceof EntryNotInBookError) {
      return NextResponse.json(
        { error: "Entry does not belong to the specified book" },
        { status: 404 }
      );
    }
    throw err;
  }
}

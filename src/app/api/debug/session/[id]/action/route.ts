import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createDebugService,
  DebugSessionNotFoundError,
  DebugInvalidActionError,
  type DebugAction,
} from "@/lib/debug/debug-service";

const VALID_ACTIONS: DebugAction[] = [
  "start_game",
  "submit_all_prompts",
  "submit_all_drawings",
  "submit_all_guesses",
  "advance_reveal",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (!action || !VALID_ACTIONS.includes(action as DebugAction)) {
    return NextResponse.json({ error: "Valid action is required" }, { status: 400 });
  }

  const service = createDebugService(db);

  try {
    await service.performAction(id, action as DebugAction);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DebugSessionNotFoundError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (err instanceof DebugInvalidActionError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

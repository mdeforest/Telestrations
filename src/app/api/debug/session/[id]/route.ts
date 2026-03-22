import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDebugService, DebugSessionNotFoundError } from "@/lib/debug/debug-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { id } = await params;
  const service = createDebugService(db);

  try {
    const state = await service.getSessionState(id);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof DebugSessionNotFoundError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    throw err;
  }
}

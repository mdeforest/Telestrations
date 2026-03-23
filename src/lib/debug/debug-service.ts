import { randomUUID } from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { rooms, players, rounds, entries, prompts } from "@/lib/db/schema";
import { createRoomService } from "@/lib/rooms/service";
import { createRevealService } from "@/lib/game/reveal-service";
import { createEntryService } from "@/lib/game/entry-service";
import { createPromptService } from "@/lib/game/prompt-service";
import { entryType } from "@/lib/game/chain-router";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

// ── Error types ──────────────────────────────────────────────────────────────

export class DebugSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Debug session not found: ${sessionId}`);
    this.name = "DebugSessionNotFoundError";
  }
}

export class DebugInvalidConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DebugInvalidConfigError";
  }
}

export class DebugInvalidActionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DebugInvalidActionError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DebugPlayer {
  playerId: string;
  nickname: string;
  seatOrder: number;
  isHost: boolean;
}

export interface DebugSession {
  id: string;
  roomCode: string;
  roomId: string;
  players: DebugPlayer[];
  createdAt: Date;
}

export type DebugAction =
  | "start_game"
  | "submit_all_prompts"
  | "submit_all_drawings"
  | "submit_all_guesses"
  | "advance_reveal";

export interface DebugPlayerState {
  playerId: string;
  nickname: string;
  isHost: boolean;
  screen: "Lobby" | "PromptSelection" | "DrawingPhase" | "GuessingPhase" | "Reveal" | "Finished";
}

export interface DebugSessionState {
  sessionId: string;
  roomCode: string;
  roomStatus: string;
  currentRound: number;
  numRounds: number;
  players: DebugPlayerState[];
}

// ── Session store (survives Next.js hot-reloads) ──────────────────────────────

const sessions: Map<string, DebugSession> =
  ((globalThis as Record<string, unknown>).__debugSessions__ as Map<string, DebugSession>) ??
  new Map();
(globalThis as Record<string, unknown>).__debugSessions__ = sessions;

// ── Service factory ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type RoomServiceLike = { startGame: (...args: unknown[]) => Promise<unknown> };
type RevealResult = { revealBookIndex: number; revealEntryIndex: number; finished: boolean; nextRound: boolean; nextRoundId: string | null };
type RevealServiceLike = { advanceReveal: (...args: unknown[]) => Promise<RevealResult> };
type EntryResult = { allSubmitted: boolean; roundComplete: boolean };
type EntryServiceLike = { submitEntry: (...args: unknown[]) => Promise<EntryResult> };
type PromptServiceLike = {
  getPromptOptions: (...args: unknown[]) => Promise<{ options: Array<{ id: string; text: string }>; alreadySelected: boolean }>;
  selectPrompt: (...args: unknown[]) => Promise<{ allSelected: boolean }>;
};

interface ServiceOverrides {
  roomServiceFactory?: (db: AnyDb) => RoomServiceLike;
  revealServiceFactory?: (db: AnyDb) => RevealServiceLike;
  entryServiceFactory?: (db: AnyDb) => EntryServiceLike;
  promptServiceFactory?: (db: AnyDb) => PromptServiceLike;
}

export function createDebugService(db: AnyDb, overrides?: ServiceOverrides) {
  const roomSvc = (overrides?.roomServiceFactory ?? createRoomService)(db) as RoomServiceLike;
  const revealSvc = (overrides?.revealServiceFactory ?? createRevealService)(db) as RevealServiceLike;
  const entrySvc = (overrides?.entryServiceFactory ?? createEntryService)(db) as EntryServiceLike;
  const promptSvc = (overrides?.promptServiceFactory ?? createPromptService)(db) as PromptServiceLike;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getSession(sessionId: string): DebugSession {
    const session = sessions.get(sessionId);
    if (!session) throw new DebugSessionNotFoundError(sessionId);
    return session;
  }

  // ── createSession ──────────────────────────────────────────────────────────

  async function createSession(playerCount: number): Promise<DebugSession> {
    if (playerCount < 4 || playerCount > 6) {
      throw new DebugInvalidConfigError(`playerCount must be 4–6, got ${playerCount}`);
    }

    const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ";
    const roomCode = Array.from(
      { length: 6 },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");

    // Insert room
    const [room] = await db
      .insert(rooms)
      .values({ code: roomCode })
      .returning();

    // Insert players one by one to capture each ID
    const createdPlayers: DebugPlayer[] = [];
    for (let i = 0; i < playerCount; i++) {
      const nickname = `Player ${i + 1}`;
      const [player] = await db
        .insert(players)
        .values({ roomId: room.id, nickname, seatOrder: i })
        .returning();
      createdPlayers.push({
        playerId: player.id,
        nickname,
        seatOrder: i,
        isHost: i === 0,
      });
    }

    // Assign host
    await db
      .update(rooms)
      .set({ hostPlayerId: createdPlayers[0].playerId })
      .where(eq(rooms.id, room.id));

    const session: DebugSession = {
      id: randomUUID(),
      roomCode: room.code,
      roomId: room.id,
      players: createdPlayers,
      createdAt: new Date(),
    };

    sessions.set(session.id, session);
    return session;
  }

  // ── getSessionState ────────────────────────────────────────────────────────

  async function getSessionState(sessionId: string): Promise<DebugSessionState> {
    const session = getSession(sessionId);

    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, session.roomId));

    let currentPass = 1;
    if (room.status === "active" || room.status === "prompts") {
      const [round] = await db
        .select()
        .from(rounds)
        .where(
          and(
            eq(rounds.roomId, room.id),
            eq(rounds.roundNumber, Math.max(room.currentRound, 1))
          )
        );
      if (round) currentPass = round.currentPass;
    }

    function deriveScreen(status: string, pass: number): DebugPlayerState["screen"] {
      switch (status) {
        case "lobby": return "Lobby";
        case "prompts": return "PromptSelection";
        case "active": return entryType(pass) === "drawing" ? "DrawingPhase" : "GuessingPhase";
        case "reveal": return "Reveal";
        case "scoring":
        case "finished": return "Finished";
        default: return "Lobby";
      }
    }

    const screen = deriveScreen(room.status, currentPass);

    return {
      sessionId: session.id,
      roomCode: session.roomCode,
      roomStatus: room.status,
      currentRound: room.currentRound,
      numRounds: room.numRounds,
      players: session.players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        isHost: p.isHost,
        screen,
      })),
    };
  }

  // ── performAction ──────────────────────────────────────────────────────────

  async function performAction(sessionId: string, action: DebugAction): Promise<void> {
    const session = getSession(sessionId);
    const host = session.players.find((p) => p.isHost)!;

    switch (action) {
      case "start_game": {
        const [room] = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, session.roomId));
        if (room.status !== "lobby") {
          throw new DebugInvalidActionError(
            `start_game requires lobby status, got ${room.status}`
          );
        }
        await roomSvc.startGame(session.roomCode, host.playerId, {
          numRounds: 3,
          scoringMode: "friendly",
        });
        const [firstRound] = await db
          .select({ id: rounds.id })
          .from(rounds)
          .where(and(eq(rounds.roomId, session.roomId), eq(rounds.roundNumber, 1)));
        if (firstRound) {
          await getAblyRest()
            .channels.get(channels.roomStatus(session.roomCode))
            .publish("room-status-changed", { status: "prompts", roundId: firstRound.id });
        }
        break;
      }

      case "advance_reveal": {
        const result = await revealSvc.advanceReveal(session.roomCode, host.playerId);
        await getAblyRest()
          .channels.get(channels.revealAdvance(session.roomCode))
          .publish("reveal:advance", result);
        if (result.nextRound && result.nextRoundId) {
          await getAblyRest()
            .channels.get(channels.roomStatus(session.roomCode))
            .publish("room-status-changed", { status: "prompts", roundId: result.nextRoundId });
        }
        break;
      }

      case "submit_all_prompts": {
        const [room] = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, session.roomId));
        const [round] = await db
          .select()
          .from(rounds)
          .where(
            and(
              eq(rounds.roomId, room.id),
              eq(rounds.roundNumber, Math.max(room.currentRound, 1))
            )
          );

        let allSelected = false;
        for (const player of session.players) {
          const { options, alreadySelected } = await promptSvc.getPromptOptions(
            round.id,
            player.playerId
          );
          if (alreadySelected) continue;

          let promptId: string;
          if (options.length > 0) {
            promptId = options[0].id;
          } else {
            // Insert sentinel prompt when table is empty
            const [sentinel] = await db
              .insert(prompts)
              .values({ text: "__debug_prompt__", category: "debug" })
              .returning();
            promptId = sentinel.id;
          }
          const selectResult = await promptSvc.selectPrompt(round.id, player.playerId, promptId);
          if (selectResult.allSelected) allSelected = true;
        }

        if (allSelected) {
          const [updatedRound] = await db
            .select({ timerStartedAt: rounds.timerStartedAt })
            .from(rounds)
            .where(eq(rounds.id, round.id));
          await getAblyRest()
            .channels.get(channels.roomStatus(session.roomCode))
            .publish("room-status-changed", {
              status: "active",
              roundId: round.id,
              timerStartedAt: updatedRound?.timerStartedAt?.toISOString() ?? null,
            });
        }
        break;
      }

      case "submit_all_drawings": {
        const [room] = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, session.roomId));
        const [round] = await db
          .select()
          .from(rounds)
          .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, room.currentRound)));

        const playerIds = session.players.map((p) => p.playerId);
        const entryRows = await db
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.passNumber, round.currentPass),
              inArray(entries.authorPlayerId, playerIds),
              isNull(entries.submittedAt)
            )
          );

        let lastResult: EntryResult | null = null;
        for (const entry of entryRows) {
          lastResult = await entrySvc.submitEntry(entry.bookId, entry.passNumber, entry.authorPlayerId, "[]");
        }
        if (lastResult?.allSubmitted) {
          if (lastResult.roundComplete) {
            await db.update(rooms).set({ status: "reveal" }).where(eq(rooms.id, session.roomId));
            await getAblyRest()
              .channels.get(channels.roomStatus(session.roomCode))
              .publish("room-status-changed", { status: "reveal" });
          } else {
            await getAblyRest()
              .channels.get(channels.roundPass(session.roomCode))
              .publish("pass-advanced", {});
          }
        }
        break;
      }

      case "submit_all_guesses": {
        const [room] = await db
          .select()
          .from(rooms)
          .where(eq(rooms.id, session.roomId));
        const [round] = await db
          .select()
          .from(rounds)
          .where(and(eq(rounds.roomId, room.id), eq(rounds.roundNumber, room.currentRound)));

        const playerIds = session.players.map((p) => p.playerId);
        const entryRows = await db
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.passNumber, round.currentPass),
              inArray(entries.authorPlayerId, playerIds),
              isNull(entries.submittedAt)
            )
          );

        let lastResult: EntryResult | null = null;
        for (const entry of entryRows) {
          lastResult = await entrySvc.submitEntry(
            entry.bookId,
            entry.passNumber,
            entry.authorPlayerId,
            "debug guess"
          );
        }
        if (lastResult?.allSubmitted) {
          if (lastResult.roundComplete) {
            await db.update(rooms).set({ status: "reveal" }).where(eq(rooms.id, session.roomId));
            await getAblyRest()
              .channels.get(channels.roomStatus(session.roomCode))
              .publish("room-status-changed", { status: "reveal" });
          } else {
            await getAblyRest()
              .channels.get(channels.roundPass(session.roomCode))
              .publish("pass-advanced", {});
          }
        }
        break;
      }

      default:
        throw new DebugInvalidActionError(`Unknown action: ${action as string}`);
    }
  }

  return { createSession, getSessionState, performAction, getSession };
}

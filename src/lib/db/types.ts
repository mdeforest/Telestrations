import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type * as schema from "./schema";

// Row types (SELECT results)
export type Room = InferSelectModel<typeof schema.rooms>;
export type Player = InferSelectModel<typeof schema.players>;
export type Round = InferSelectModel<typeof schema.rounds>;
export type Book = InferSelectModel<typeof schema.books>;
export type Entry = InferSelectModel<typeof schema.entries>;
export type Prompt = InferSelectModel<typeof schema.prompts>;
export type Score = InferSelectModel<typeof schema.scores>;
export type Vote = InferSelectModel<typeof schema.votes>;

// Insert types (all PKs/defaults are optional)
export type NewRoom = InferInsertModel<typeof schema.rooms>;
export type NewPlayer = InferInsertModel<typeof schema.players>;
export type NewRound = InferInsertModel<typeof schema.rounds>;
export type NewBook = InferInsertModel<typeof schema.books>;
export type NewEntry = InferInsertModel<typeof schema.entries>;
export type NewPrompt = InferInsertModel<typeof schema.prompts>;
export type NewScore = InferInsertModel<typeof schema.scores>;
export type NewVote = InferInsertModel<typeof schema.votes>;

// Enum value types — inferred from schema, always in sync
export type RoomStatus = Room["status"];
export type ScoringMode = Room["scoringMode"];
export type EntryType = Entry["type"];
export type ScoreReason = Score["reason"];
export type VoteType = Vote["voteType"];

import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────────────────

export const roomStatusEnum = pgEnum("room_status", [
  "lobby",
  "prompts",
  "active",
  "reveal",
  "scoring",
  "finished",
]);

export const scoringModeEnum = pgEnum("scoring_mode", [
  "friendly",
  "competitive",
]);

export const entryTypeEnum = pgEnum("entry_type", ["drawing", "guess"]);

export const scoreReasonEnum = pgEnum("score_reason", [
  "correct_guess",
  "aided_correct",
  "drawing_credited",
  "favorite_sketch",
  "favorite_guess",
  "chain_survived",
]);

export const voteTypeEnum = pgEnum("vote_type", [
  "favorite_sketch",
  "favorite_guess",
]);

// ── Tables ─────────────────────────────────────────────────────────────────

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").unique().notNull(),
    status: roomStatusEnum("status").notNull().default("lobby"),
    // No .references() here — circular FK with players.
    // The FK constraint is added manually in the generated migration via ALTER TABLE.
    hostPlayerId: uuid("host_player_id"),
    numRounds: integer("num_rounds").notNull().default(3),
    currentRound: integer("current_round").notNull().default(0),
    scoringMode: scoringModeEnum("scoring_mode").notNull().default("friendly"),
    revealBookIndex: integer("reveal_book_index").notNull().default(0),
    revealEntryIndex: integer("reveal_entry_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rooms_code_idx").on(t.code)]
);

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    seatOrder: integer("seat_order").notNull(),
    isConnected: boolean("is_connected").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.roomId, t.seatOrder),
    unique().on(t.roomId, t.nickname),
    index("players_room_id_idx").on(t.roomId),
  ]
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    currentPass: integer("current_pass").notNull().default(1),
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.roomId, t.roundNumber),
    index("rounds_room_id_idx").on(t.roomId),
  ]
);

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  roundId: uuid("round_id")
    .notNull()
    .references(() => rounds.id, { onDelete: "cascade" }),
  ownerPlayerId: uuid("owner_player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  originalPrompt: text("original_prompt").notNull(),
});

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    passNumber: integer("pass_number").notNull(),
    authorPlayerId: uuid("author_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    type: entryTypeEnum("type").notNull(),
    content: text("content").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    isBlank: boolean("is_blank").notNull().default(false),
    fuzzyCorrect: boolean("fuzzy_correct"),
    ownerOverride: boolean("owner_override"),
  },
  (t) => [
    unique().on(t.bookId, t.passNumber),
    index("entries_book_id_idx").on(t.bookId),
    index("entries_author_player_id_idx").on(t.authorPlayerId),
  ]
);

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").unique().notNull(),
  category: text("category"),
});

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    points: integer("points").notNull().default(0),
    reason: scoreReasonEnum("reason").notNull(),
  },
  (t) => [
    index("scores_room_id_idx").on(t.roomId),
    index("scores_player_id_idx").on(t.playerId),
  ]
);

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    voterPlayerId: uuid("voter_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    voteType: voteTypeEnum("vote_type").notNull(),
  },
  (t) => [
    unique().on(t.bookId, t.voterPlayerId, t.voteType),
    index("votes_book_id_idx").on(t.bookId),
  ]
);

// ── Relations ──────────────────────────────────────────────────────────────

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  hostPlayer: one(players, {
    fields: [rooms.hostPlayerId],
    references: [players.id],
  }),
  players: many(players),
  rounds: many(rounds),
  scores: many(scores),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  room: one(rooms, { fields: [players.roomId], references: [rooms.id] }),
  books: many(books),
  entries: many(entries),
  scores: many(scores),
  votes: many(votes),
}));

export const roundsRelations = relations(rounds, ({ one, many }) => ({
  room: one(rooms, { fields: [rounds.roomId], references: [rooms.id] }),
  books: many(books),
  scores: many(scores),
}));

export const booksRelations = relations(books, ({ one, many }) => ({
  round: one(rounds, { fields: [books.roundId], references: [rounds.id] }),
  owner: one(players, {
    fields: [books.ownerPlayerId],
    references: [players.id],
  }),
  entries: many(entries),
  votes: many(votes),
}));

export const entriesRelations = relations(entries, ({ one, many }) => ({
  book: one(books, { fields: [entries.bookId], references: [books.id] }),
  author: one(players, {
    fields: [entries.authorPlayerId],
    references: [players.id],
  }),
  votes: many(votes),
}));

export const scoresRelations = relations(scores, ({ one }) => ({
  room: one(rooms, { fields: [scores.roomId], references: [rooms.id] }),
  round: one(rounds, { fields: [scores.roundId], references: [rounds.id] }),
  player: one(players, {
    fields: [scores.playerId],
    references: [players.id],
  }),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  book: one(books, { fields: [votes.bookId], references: [books.id] }),
  voter: one(players, {
    fields: [votes.voterPlayerId],
    references: [players.id],
  }),
  entry: one(entries, { fields: [votes.entryId], references: [entries.id] }),
}));

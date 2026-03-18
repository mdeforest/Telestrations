CREATE TYPE "public"."entry_type" AS ENUM('drawing', 'guess');--> statement-breakpoint
CREATE TYPE "public"."room_status" AS ENUM('lobby', 'prompts', 'active', 'reveal', 'scoring', 'finished');--> statement-breakpoint
CREATE TYPE "public"."score_reason" AS ENUM('correct_guess', 'aided_correct', 'favorite_sketch', 'favorite_guess', 'chain_survived');--> statement-breakpoint
CREATE TYPE "public"."scoring_mode" AS ENUM('friendly', 'competitive');--> statement-breakpoint
CREATE TYPE "public"."vote_type" AS ENUM('favorite_sketch', 'favorite_guess');--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"owner_player_id" uuid NOT NULL,
	"original_prompt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"pass_number" integer NOT NULL,
	"author_player_id" uuid NOT NULL,
	"type" "entry_type" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_blank" boolean DEFAULT false NOT NULL,
	"fuzzy_correct" boolean,
	"owner_override" boolean,
	CONSTRAINT "entries_book_id_pass_number_unique" UNIQUE("book_id","pass_number")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"seat_order" integer NOT NULL,
	"is_connected" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_room_id_seat_order_unique" UNIQUE("room_id","seat_order"),
	CONSTRAINT "players_room_id_nickname_unique" UNIQUE("room_id","nickname")
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"category" text,
	CONSTRAINT "prompts_text_unique" UNIQUE("text")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"status" "room_status" DEFAULT 'lobby' NOT NULL,
	"host_player_id" uuid,
	"num_rounds" integer DEFAULT 3 NOT NULL,
	"current_round" integer DEFAULT 0 NOT NULL,
	"scoring_mode" "scoring_mode" DEFAULT 'friendly' NOT NULL,
	"reveal_book_index" integer DEFAULT 0 NOT NULL,
	"reveal_entry_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"current_pass" integer DEFAULT 1 NOT NULL,
	"timer_started_at" timestamp with time zone,
	CONSTRAINT "rounds_room_id_round_number_unique" UNIQUE("room_id","round_number")
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"reason" "score_reason" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"voter_player_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"vote_type" "vote_type" NOT NULL,
	CONSTRAINT "votes_book_id_voter_player_id_vote_type_unique" UNIQUE("book_id","voter_player_id","vote_type")
);
--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_owner_player_id_players_id_fk" FOREIGN KEY ("owner_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_player_id_players_id_fk" FOREIGN KEY ("author_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_player_id_players_id_fk" FOREIGN KEY ("voter_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_book_id_idx" ON "entries" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "entries_author_player_id_idx" ON "entries" USING btree ("author_player_id");--> statement-breakpoint
CREATE INDEX "players_room_id_idx" ON "players" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "rooms_code_idx" ON "rooms" USING btree ("code");--> statement-breakpoint
CREATE INDEX "rounds_room_id_idx" ON "rounds" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "scores_room_id_idx" ON "scores" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "scores_player_id_idx" ON "scores" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "votes_book_id_idx" ON "votes" USING btree ("book_id");--> statement-breakpoint
-- Circular FK: rooms.host_player_id → players.id (added after players table exists)
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_player_id_players_id_fk" FOREIGN KEY ("host_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
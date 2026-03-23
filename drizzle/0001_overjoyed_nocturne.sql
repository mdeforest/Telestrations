ALTER TYPE "public"."score_reason" ADD VALUE 'drawing_credited' BEFORE 'favorite_sketch';--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "host_phone_connected_at" timestamp with time zone;
# Telestrations — Claude Code Guide

## Project Overview

A web-based multiplayer Telestrations party game. Players join via room code, draw and guess in simultaneous rounds, and watch a cinematic reveal at the end. Built with Next.js and Supabase.

## Current Status

Issue #6 in review (PR #20, branch `feat/prompt-selection-issue-6`) — prompt selection service and API routes implemented. `createPromptService(db)` factory in `src/lib/game/prompt-service.ts` with `selectPrompt` (records player's chosen prompt in `books.originalPrompt`, transitions room to `active` when all players selected) and `getPromptOptions` (returns 3 randomly sampled prompts). `GET /api/rounds/[id]/prompts` serves options; `POST /api/rounds/[id]/prompt` records selection. 37 Vitest tests total (7 new). Issue #5 (PR #17, chain router) and Issue #18 (host phone join) still open. Provision Neon + Ably and fill in `.env.local` (see `.env.local.example`) before running.

## Stack

- **Framework:** Next.js (App Router)
- **Database:** Neon (serverless Postgres)
- **ORM:** Drizzle (schema-as-code; migrations via `drizzle-kit`)
- **Realtime:** Ably (channel-based pub/sub, token auth)
- **Deployment:** Internet-hosted (public URL)

## Key Design Decisions

See `docs/decisions.md` for the full decision log. Key points:

- Ephemeral auth — nickname only, no accounts
- Simultaneous drawing (all players draw at once), 60s server-authoritative timer
- Chain routing differs for even vs odd player counts (see decisions.md)
- Two scoring modes: friendly (votes) and competitive (points for correct guesses)
- Drawing stored as JSON path data (array of strokes)
- Host screen (TV/laptop) + player phones as separate UI surfaces
- Neon chosen for unlimited free projects; Ably chosen for 6M messages/month free tier and identical channel-scoping model to what was originally planned

## Conventions

- Never commit to `main`
- Commit format: `type(scope): short description`
- Fix TypeScript/lint errors immediately, including pre-existing ones

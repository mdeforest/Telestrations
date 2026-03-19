# Telestrations — Claude Code Guide

## Project Overview

A web-based multiplayer Telestrations party game. Players join via room code, draw and guess in simultaneous rounds, and watch a cinematic reveal at the end. Built with Next.js and Supabase.

## Current Status

Issue #9 (Guessing Phase) in PR #24 (branch `feat/guessing-phase-issue-9`) — complete. 89 Vitest tests passing. Issues #8 (PR #22), #6 (PR #20) merged. Provision Neon + Ably and fill in `.env.local` before running.

Key additions in issue #9: `GuessingPhaseScreen` (read-only canvas replay + text input + timer); `POST /api/entries` accepts `type: 'guess'`; entry-service round-completion detection (`roundComplete: boolean` from both `submitEntry` and `expirePass`); multi-round progression in the entries route (next round → `prompts`, final round → `reveal`); `my-entry` returns `type` + `incomingContent`; `LobbyPlayerList` routes on pass type.

**Testing deps:** `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`. Per-file jsdom: `// @vitest-environment jsdom`. entry-service mocks use index-based `makeSelectSequence` — add new query responses when extending service methods or existing tests break.

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

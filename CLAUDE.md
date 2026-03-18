# Telestrations — Claude Code Guide

## Project Overview

A web-based multiplayer Telestrations party game. Players join via room code, draw and guess in simultaneous rounds, and watch a cinematic reveal at the end. Built with Next.js and Supabase.

## Current Status

Issue #7 in PR #21 (branch `feat/drawing-canvas-issue-7`) — DrawingCanvas component complete. Mouse + touch drawing, brush size control, stroke serialization, replay. 56 Vitest tests (8 for canvas, with @testing-library/react + jsdom). Issue #6 (PR #20) merged. Issue #5 (PR #17, chain router) still open. Provision Neon + Ably and fill in `.env.local` before running.

**New testing deps added:** `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` — needed for React component tests. `vitest.config.ts` now includes the React plugin. Per-file jsdom override: `// @vitest-environment jsdom`.

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

# Telestrations — Claude Code Guide

## Project Overview

A web-based multiplayer Telestrations party game. Players join via room code, draw and guess in simultaneous rounds, and watch a cinematic reveal at the end. Built with Next.js and Supabase.

## Current Status

Timer enforcement in PR #34 (branch `feat/timer-enforcement`) — complete. Issue #13 (Competitive Scoring) in PR #30 (branch `feat/competitive-scoring-issue-13`) — complete. Per-round reveal in PR (branch `feat/reveal-each-round`) — complete. 224 Vitest tests (214 passing; 10 pre-existing failures in `reveal/advance` and `reveal/books` tests — unrelated to timer work). Issue #27 (PR #29), #12 (PR #28), #11 (PR #26), #9 (PR #24), #8 (PR #22), #6 (PR #20) merged. Provision Neon + Ably and fill in `.env.local` before running.

Key additions in issue #13: `competitive-score-service` (`tallyCompetitiveScores`: uses `ownerOverride ?? fuzzyCorrect` to determine correctness, writes `correct_guess` + `drawing_credited` score rows); `PATCH /api/entries/[id]/override` (book-owner-only, sets `ownerOverride`); `entry-service.submitEntry` extended with optional `scoringMode` param — computes `fuzzyCorrect` for guess entries in competitive mode; `POST /api/rooms/[code]/tally` branches on `scoringMode`; `POST /api/entries` resolves `scoringMode` via book→round→room join before calling `submitEntry`; `drawing_credited` added to `scoreReasonEnum`.

Key additions in issue #27: `DebugService` (`createSession`, `getSessionState`, `performAction`); debug API routes; `/debug` page with `DebugDashboard`. Per-tab player identity via `X-Debug-Player-Id` header: `debug-fetch.ts` wrapper injects header from `sessionStorage`; `get-player-id.ts` helper checks header before cookie in dev; all 11 player-facing API routes use `getPlayerId()`; `as-player` redirect uses `?debugPlayerId=` URL param (not cookie); `LobbyPlayerList` reads param on mount, stores to sessionStorage, resets Ably client; all screen components use `debugFetch`. Sessions stored in `globalThis.__debugSessions__` Map to survive hot-reloads.

Key additions in issue #12: `vote-service` (`castVote`: self-vote guard, entry-in-book guard; `tallyVotes`: counts votes → writes 1 score row per vote received); `POST /api/votes`; `POST /api/rooms/[code]/tally` (host-only, broadcasts `scoring:complete` Ably event with leaderboard); `GET /api/rooms/[code]/leaderboard`; `PlayerRevealScreen` voting panel (per-book, sketch + guess, friendly mode only); `HostRevealScreen` tally button + leaderboard display; `channels.scoringComplete` added.

Per-round reveal additions (branch `feat/reveal-each-round`): `reveal-service.advanceReveal` scopes books to current round via `roundNumber = Math.max(currentRound, 1)`; returns `{ nextRound, nextRoundId }` — on last book of a non-final round, transitions room to `prompts` for next round; `POST /api/rooms/[code]/reveal/advance` publishes `room-status-changed { status: "prompts", roundId }` when `nextRound=true`; `GET /api/rooms/[code]/reveal/books` now scopes to current round only (not all rounds); `DrawingCanvas` gets `bg-white` so black strokes are visible on dark host screen; entries route always sets `status: "reveal"` when a round completes (removed intermediate "start next round" logic).

Key additions in issue #11: `reveal-service` (`advanceReveal`: entry/book/finished progression, host-only guard); `POST /api/rooms/[code]/reveal/advance` broadcasts `reveal:advance` Ably event; `GET /api/rooms/[code]/reveal/books` returns books with entries ordered by seat; `HostRevealScreen` (cinematic TV display with chain timeline); `PlayerRevealScreen` (phone view with own-entry highlight and host advance button); `HostLobby` + `LobbyPlayerList` wired for reveal/finished transitions.

Key additions in issue #9: `GuessingPhaseScreen` (read-only canvas replay + text input + timer); `POST /api/entries` accepts `type: 'guess'`; entry-service round-completion detection (`roundComplete: boolean` from both `submitEntry` and `expirePass`); multi-round progression in the entries route (next round → `prompts`, final round → `reveal`); `my-entry` returns `type` + `incomingContent`; `LobbyPlayerList` routes on pass type.

**Testing deps:** `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`. Per-file jsdom: `// @vitest-environment jsdom`. entry-service mocks use index-based `makeSelectSequence` — add new query responses when extending service methods or existing tests break. Route tests mock `@/lib/db` with a `terminal` vi.fn() queue (one call per DB query in sequence via `mockResolvedValueOnce`).

**fuzzyMatch** in `src/lib/game/fuzzy-match.ts` (branch `feat/fuzzy-match-issue-10`) — pure function, Levenshtein-based, full test suite (issue #10).

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
- Host-screen layouts should fit within the target viewport without requiring vertical scrolling; scale content to the available height instead of letting fixed/sticky chrome cover important UI such as QR codes or controls
- Git worktrees go in `.worktrees/` (project-local, hidden)

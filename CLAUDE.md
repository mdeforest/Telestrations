# Telestrations — Claude Code Guide

## Project Overview

A web-based multiplayer Telestrations party game. Players join via room code, draw and guess in simultaneous rounds, and watch a cinematic reveal at the end. Built with Next.js and Supabase.

## Current Status

Issue #2 complete — project scaffold implemented. Next.js 16 App Router + TypeScript initialized, Supabase client configured, all 8 DB tables in migration, prompts seeded, lint and typecheck pass. Supabase project provisioning and env vars still require manual setup (see `.env.local.example`).

## Stack

- **Framework:** Next.js (App Router)
- **Realtime:** Supabase Realtime
- **Database:** Supabase (Postgres)
- **Deployment:** Internet-hosted (public URL)

## Key Design Decisions

See `docs/decisions.md` for the full decision log. Key points:

- Ephemeral auth — nickname only, no accounts
- Simultaneous drawing (all players draw at once), 60s server-authoritative timer
- Chain routing differs for even vs odd player counts (see decisions.md)
- Two scoring modes: friendly (votes) and competitive (points for correct guesses)
- Drawing stored as JSON path data (array of strokes)
- Host screen (TV/laptop) + player phones as separate UI surfaces

## Conventions

- Never commit to `main`
- Commit format: `type(scope): short description`
- Fix TypeScript/lint errors immediately, including pre-existing ones

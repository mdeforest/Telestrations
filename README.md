# Telestrations

A browser-based multiplayer Telestrations party game. Players join via room code, draw and guess in simultaneous rounds, then watch a cinematic chain reveal at the end.

## Stack

- **Next.js** — framework
- **Supabase** — database, auth, and realtime
- **Deployment** — internet-hosted (public URL, no LAN required)

## How It Works

1. One player creates a room and shares the 6-character code
2. Everyone joins on their phone (nickname only, no account needed)
3. Each round: players pick a prompt, draw it, then pass — alternating drawing and guessing
4. After all rounds, the host leads a cinematic book-by-book reveal
5. Score points for correct guesses, favorite sketches, and favorite guesses

Supports 4–12 players. Works with a host screen (TV/laptop) + player phones as separate surfaces.

## Docs

- [`docs/decisions.md`](docs/decisions.md) — architecture and design decisions
- [`docs/prd.md`](docs/prd.md) — full product requirements document

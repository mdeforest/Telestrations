# Lobby Join Flow Redesign

**Date:** 2026-03-22
**Status:** Approved

## Problem

The current lobby flow is confusing in three ways:

1. **Duplicate controls** — both the desktop (`/room/[code]/host`) and the phone host (`/room/[code]` with `isHost=true`) show identical settings + start button. It's unclear which surface is authoritative.
2. **No path from room creation to the desktop view** — `handleCreate` redirects to `/room/[code]`, but the desktop host view lives at `/room/[code]/host`. There's no link between them, so hosts have to manually type the URL.
3. **QR confusion** — the existing QR code on the desktop is for the host to connect their phone, but players instinctively try to scan any QR they see.

## Design

### Core principle

**Phone host owns all game controls.** Desktop is a read-only dashboard — it shows status and helps players join, but has no interactive controls.

### Flow

1. Host goes to `telestrations.com` on their laptop, enters a nickname, clicks "Create Room"
2. `handleCreate` redirects to `/room/${code}/host` (changed from `/room/${code}`)
3. Desktop shows the lobby dashboard — player grid, read-only settings summary, join panel
4. Players scan the QR on the TV, or go to `telestrations.com` and type the room code manually
5. Host hovers over the blurred host QR on the desktop and scans it on their phone → lands on phone host view
6. Phone host adjusts settings and presses Start when ready

### Changes by file

#### `src/app/page.tsx`

- `handleCreate` redirects to `/room/${data.code}/host` instead of `/room/${data.code}`
- On component mount, use `useEffect` + `window.location.search` (already a `"use client"` component using `useState`) to read `?code=` URL param and pre-fill the `joinCode` state. This allows the player join QR (`/?code=XKQZ`) to auto-populate the room code field so players only need to enter their nickname and tap Join.

#### `src/app/room/[code]/host/HostLobby.tsx` — left panel

The existing QR (`connectUrl`) links to `/room/${code}/connect?pid=${hostPlayerId}` — this is the host-phone connect QR. Replace the entire left panel with three stacked zones:

1. **Player join QR** (prominent) — `QRCodeSVG` pointing to `${origin}/?code=${code}`. Labeled "Scan to join the game".
2. **Manual fallback** — static text: "Or go to **telestrations.com** and enter room code **{code}**". Room code displayed large.
3. **Host QR** (blurred by default) — same `connectUrl` (`/room/${code}/connect?pid=${hostPlayerId}`) as today. Wrapped in a container that applies `filter: blur(8px)` / `opacity-30` by default. On `onMouseEnter` remove blur; on `onMouseLeave` restore it. Labeled "👑 Host — hover to reveal your controller QR".

#### `src/app/room/[code]/host/HostLobby.tsx` — state and dead code removal

The following are no longer needed and must be deleted:

- `phoneConnected` state and setter
- `showQr` state and setter (currently unused but present)
- `starting` state and setter
- `startError` state and setter
- `canStart` constant
- `handleStart` function
- The Ably subscription to `host-phone-connected` (lines subscribing `playersCh` for `"host-phone-connected"`)

#### `src/app/room/[code]/host/HostLobby.tsx` — footer

- Remove the Start Game button and the `!canStart` error banner entirely
- Replace the rounds stepper (+/− buttons) and scoring mode toggle with read-only text: current values displayed as plain text
- Add a small label "Set on host phone" beneath the settings display
- Keep the Room Code display as-is
- `numRounds` and `scoringMode` state may be kept as read-only (initialized from `initialScoringMode` / a hardcoded default) since they're displayed, but should have no setters called from this component

> **Known limitation:** The desktop settings display shows the values from server render. If the host changes rounds or scoring mode on their phone before starting, the desktop display will lag and show stale values. Live settings sync is out of scope — this is acceptable since the TV is informational, not authoritative.

#### `src/app/room/[code]/LobbyPlayerList.tsx` — host branch

The `isHost` branch currently has a two-panel layout that includes a fake/non-functional QR placeholder (a CSS grid of `<div>`s with a blur overlay labeled "Scan to Join!"). Under the new design this placeholder serves no purpose — the phone host is the controller, not a join point.

Changes:

- Remove the fake QR placeholder panel from the `isHost` branch entirely
- Add a "👑 You're the Host" badge at the top of the `isHost` branch (before the player grid / settings)
- All other elements (settings controls, start button, player grid, footer) stay exactly as-is

#### `src/app/room/[code]/connect/route.ts`

No changes. The route still publishes `host-phone-connected` to Ably on scan — this publish becomes vestigial (nothing consumes it after `HostLobby.tsx` removes the listener), but it is harmless and can be cleaned up in a future pass.

### What does NOT change

- All game phases (prompts, drawing, guessing, reveal) — untouched
- Regular player view (`isHost=false` branch of `LobbyPlayerList`) — untouched
- Desktop host views for active game phases (`HostDrawingScreen`, `HostPromptsWaiting`, `HostRevealScreen`) — untouched
- No new routes or API endpoints

### Edge cases

- **Host opens `/room/[code]` directly** (e.g. from a bookmark after creating a room) — they land on the phone host view (`isHost=true`), which still has full controls. This is fine.
- **Host hasn't connected their phone yet** — the desktop shows "Waiting for host to start..." status in the player area. There is no server-side enforcement that the host must connect their phone before starting; the Start button on the phone host view works regardless of whether the host scanned the host QR. This is acceptable.
- **`?code=` param on home page with invalid code** — existing join error handling in `handleJoin` covers it; no new error handling needed.
- **Player accidentally scans the host QR** — they land on `/room/[code]/connect?pid=${hostPlayerId}`, which sets their `playerId` cookie to the host's player ID. This is the same risk as today and is acceptable — it requires physically scanning the blurred QR on a laptop screen.

## Out of scope

- Settings sync between desktop and phone (desktop is read-only — no sync needed; stale display is acceptable)
- Responsive/mobile detection to auto-select desktop vs phone host view
- Kick players, extend timer, or other in-game host controls beyond the lobby
- Cleaning up the vestigial `host-phone-connected` publish in `connect/route.ts`

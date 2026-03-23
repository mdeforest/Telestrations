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

### UI change constraint

**Keep UI changes to the absolute minimum.** This spec is about flow and behaviour, not visual redesign. Every change must be the smallest possible modification to existing components. Do not:
- Introduce new layout patterns or restructure existing ones
- Change colours, typography, spacing, or component styles
- Replace existing UI elements with new ones when the existing element can be adapted
- Add new visual flourishes or animations

Acceptable UI changes are: swapping a control for its read-only text equivalent, adding a single badge/label, replacing one QR with another, and adding a blur overlay to an existing element. Everything else stays exactly as it is today.

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

- `showQr` state and setter (currently unused but present)
- `starting` state and setter
- `startError` state and setter
- `canStart` constant
- `handleStart` function

The following must be **kept**:

- `phoneConnected` state and the Ably subscription to `host-phone-connected` — used to confirm the host phone has connected and hide the host QR (see left panel section below).

#### `src/app/room/[code]/host/HostLobby.tsx` — host QR post-connection behaviour

Once `phoneConnected` becomes `true` (via the Ably event), the host QR zone should transition from the blurred QR to a confirmation state: hide the QR entirely and show "✓ Host phone connected" text. This prevents the host from accidentally sharing the QR after it has been claimed.

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

#### `src/lib/db/schema.ts` + migration

Add a nullable `hostPhoneConnectedAt` timestamp column to the `rooms` table:

```ts
hostPhoneConnectedAt: timestamp("host_phone_connected_at", { withTimezone: true }),
```

Generate and apply a Drizzle migration for this column.

#### `src/app/room/[code]/connect/route.ts`

Add a one-time-use guard for the host QR:

1. After loading the room, check: if `pid === room.hostPlayerId` AND `room.hostPhoneConnectedAt` is not null → return a user-friendly error response (HTTP 409) with a message such as "This host QR has already been used. Ask the host to show you the player join code instead."
2. If this is the first connection (`hostPhoneConnectedAt` is null): update the room with a conditional `WHERE host_phone_connected_at IS NULL` clause so that a race between two simultaneous scans only lets one through. If the conditional update affects 0 rows, treat it as already-claimed and return the 409 error.
3. The existing `host-phone-connected` Ably publish remains — `HostLobby.tsx` still consumes it to update `phoneConnected` state and hide the QR.

### What does NOT change

- All game phases (prompts, drawing, guessing, reveal) — untouched
- Regular player view (`isHost=false` branch of `LobbyPlayerList`) — untouched
- Desktop host views for active game phases (`HostDrawingScreen`, `HostPromptsWaiting`, `HostRevealScreen`) — untouched
- No new routes (one new DB column and migration)

### Edge cases

- **Host opens `/room/[code]` directly** (e.g. from a bookmark after creating a room) — they land on the phone host view (`isHost=true`), which still has full controls. This is fine.
- **Host hasn't connected their phone yet** — the desktop shows "Waiting for host to start..." status in the player area. There is no server-side enforcement that the host must connect their phone before starting; the Start button on the phone host view works regardless of whether the host scanned the host QR. This is acceptable.
- **`?code=` param on home page with invalid code** — existing join error handling in `handleJoin` covers it; no new error handling needed.
- **Player accidentally scans the host QR after it's been claimed** — the `connect` route returns a 409 with a friendly error message. Their cookie is not modified.
- **Player scans the host QR before the host has connected** — they claim the host phone slot. Mitigated by the blurred hover-to-reveal UI making the QR hard to accidentally scan. If this happens, the host can no longer connect their phone via QR (same risk as today, now with one-time-use enforcement).

## Out of scope

- Settings sync between desktop and phone (desktop is read-only — no sync needed; stale display is acceptable)
- Responsive/mobile detection to auto-select desktop vs phone host view
- Kick players, extend timer, or other in-game host controls beyond the lobby
- Resetting `hostPhoneConnectedAt` if the host wants to re-claim their phone (not needed for current use cases)

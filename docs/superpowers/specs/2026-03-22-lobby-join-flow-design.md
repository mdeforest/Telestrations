# Lobby Join Flow Redesign

**Date:** 2026-03-22
**Status:** Approved

## Problem

The current lobby flow is confusing in two ways:

1. **Duplicate controls** — both the desktop (`/room/[code]/host`) and the phone host (`/room/[code]` with `isHost=true`) show identical settings + start button. It's unclear which surface is authoritative.
2. **No path from room creation to the desktop view** — `handleCreate` redirects to `/room/[code]`, but the desktop host view lives at `/room/[code]/host`. There's no link between them, so hosts have to manually type the URL.
3. **QR confusion** — the existing QR code on the desktop is for the host to connect their phone, but players instinctively try to scan any QR they see.

## Design

### Core principle

**Phone host owns all game controls.** Desktop is a read-only dashboard — it shows status and helps players join, but has no interactive controls.

### Flow

1. Host goes to `telestrations.com` on their laptop, enters a nickname, clicks "Create Room"
2. `handleCreate` redirects to `/room/${code}/host` (changed from `/room/${code}`)
3. Desktop shows the lobby dashboard — player grid, read-only settings, join panel
4. Players scan the QR on the TV or go to `telestrations.com` and type the room code
5. Host scans the blurred host QR (hover to reveal) on their own phone → phone gets host identity → lands on phone host view
6. Phone host adjusts settings and presses Start when ready

### Changes by file

#### `src/app/page.tsx`

- `handleCreate` redirects to `/room/${data.code}/host` instead of `/room/${data.code}`
- On component mount, read `?code=` URL param and pre-fill the room code input. This allows the player join QR (`/?code=XKQZ`) to auto-populate the code field so players only need to enter their nickname.

#### `src/app/room/[code]/host/HostLobby.tsx` — left panel

Replace the existing single host-phone QR panel with three stacked zones:

1. **Player join QR** (prominent) — `QRCodeSVG` pointing to `${origin}/?code=${code}`. Labeled "Scan to join the game".
2. **Manual fallback** — static text: "Or go to **telestrations.com** and enter room code **{code}**". Room code displayed large.
3. **Host QR** (blurred by default) — same `connect?pid=` URL as today. Wrapped in a div that applies `filter: blur(8px)` by default and removes it on `onMouseEnter`. Labeled "👑 Host — hover to reveal". Remove the `phoneConnected` / "Waiting for phone..." indicator.

#### `src/app/room/[code]/host/HostLobby.tsx` — footer

- Remove the Start Game button entirely
- Replace the rounds stepper and scoring mode toggle with read-only text display of current values
- Add a small label "Set on host phone" below the settings display
- Keep the Room Code display as-is

#### `src/app/room/[code]/LobbyPlayerList.tsx` — host branch

- Add a "👑 You're the Host" badge at the top of the `isHost` branch (before the player grid)
- No other changes — settings controls, start button, player grid, and footer all stay exactly as-is

### What does NOT change

- All game phases (prompts, drawing, guessing, reveal) — untouched
- Regular player view (`isHost=false` branch of `LobbyPlayerList`) — untouched
- `/room/[code]/connect` route — untouched
- Desktop host views for active game phases (`HostDrawingScreen`, `HostPromptsWaiting`, `HostRevealScreen`) — untouched
- No new routes or API endpoints

### Edge cases

- **Host opens `/room/[code]` directly** (e.g. from a bookmark) — they'll land on the phone host view (`isHost=true`), which still has full controls. This is fine.
- **Host hasn't connected their phone yet** — desktop shows "Waiting for host to start…" status in the player grid area. Game can't start until host scans the host QR.
- **Player scans the host QR** — they land on `/room/[code]/connect?pid=${hostPlayerId}` which sets the `playerId` cookie to the host's player ID. This is the same risk as today. Acceptable — requires knowing the URL structure and the host's player ID.
- **`?code=` param on home page** — if the code doesn't match an active room, the existing join error handling covers it.

## Out of scope

- Settings sync between desktop and phone (desktop is read-only — no sync needed)
- Responsive/mobile detection to auto-select desktop vs phone host view
- Kick players, extend timer, or other in-game host controls beyond the lobby

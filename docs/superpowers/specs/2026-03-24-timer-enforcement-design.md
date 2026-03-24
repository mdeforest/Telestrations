# Timer Enforcement Design

**Date:** 2026-03-24
**Status:** Approved

## Overview

Make the 2-minute round timer meaningful: auto-submit drawings at t=0, urge guessers to finish, and show phase-aware status on the host dashboard.

## Scope

Three surfaces are touched:
- `/api/rounds/[id]/drawing-status` — new `passType` field
- `DrawingCanvas` + `DrawingPhaseScreen` — drawing auto-submit
- `GuessingPhaseScreen` — guessing urgency banner
- `HostDrawingScreen` — phase-aware labels and t=0 urgency badge

Out of scope: server-side timer enforcement (the existing `DELETE /api/entries` expire route is not changed).

---

## Section 1: API — drawing-status passType

**File:** `src/app/api/rounds/[id]/drawing-status/route.ts`

Add `passType: "drawing" | "guess"` to the response. Implementation: query one entry from `entries` where `bookId IN (round's books)` and `passNumber = round.currentPass`, read its `type` column. If no entries exist yet, fall back to `"drawing"`.

**Response shape (after change):**
```ts
{
  timerStartedAt: string | null;
  currentPass: number;
  passType: "drawing" | "guess";
  pendingNicknames: string[];
  disconnectedNicknames: string[];
}
```

No new DB queries beyond what already runs — we can fold the type lookup into the existing entry query.

---

## Section 2: Drawing auto-submit

### DrawingCanvas

Add optional prop `triggerAutoSubmit?: boolean`. In a `useEffect` that depends on `triggerAutoSubmit`:
- When it becomes `true`, call `onSubmit(strokes)` immediately (submits whatever strokes are committed; empty array if player never drew)
- Set internal `disabled` state to prevent double-submit

**Interface change:**
```ts
interface DrawingCanvasProps {
  onSubmit: (strokes: Stroke[]) => void;
  replayStrokes?: Stroke[];
  disabled?: boolean;
  readOnly?: boolean;
  triggerAutoSubmit?: boolean;   // NEW
}
```

### DrawingPhaseScreen

Add `const [autoSubmit, setAutoSubmit] = useState(false)`.

In the existing countdown `useEffect`, when `remaining === 0`, call `setAutoSubmit(true)`.

Pass `triggerAutoSubmit={autoSubmit}` to `<DrawingCanvas>`.

The existing `handleSubmit` callback handles the API call, loading state, and transition to `PlayerWaitingScreen` — no changes needed there.

---

## Section 3: Guessing phase — player urgency banner

**File:** `src/app/room/[code]/GuessingPhaseScreen.tsx`

`GuessingPhaseScreen` already tracks `secondsLeft`. Add:

```ts
const timeExpired = secondsLeft === 0 && !submitted;
```

When `timeExpired` is true, render an urgent banner above the input:
- Background: `bg-error-container text-on-error-container`
- Pulsing animation
- Text: "Time's up! Submit your guess now."
- Icon: `timer_off` or `warning`

The input and submit button remain functional — players can still submit after the timer hits 0.

---

## Section 4: Host dashboard — phase-aware + t=0 indicator

**File:** `src/app/room/[code]/host/HostDrawingScreen.tsx`

### Timer fix
Change `ROUND_DURATION_SECONDS` from 60 → 120 to match player screens.

Also reset `timerStartedAt` on `pass-advanced` (same fix applied to `LobbyPlayerList` previously):
```ts
const onPassAdvanced = () => {
  setTimerStartedAt(new Date().toISOString());
  fetchStatus();
};
```

### DrawingStatus type update
```ts
interface DrawingStatus {
  timerStartedAt: string | null;
  currentPass: number;
  passType: "drawing" | "guess";   // NEW
  pendingNicknames: string[];
  disconnectedNicknames: string[];
}
```

Default `passType` in initial state: `"drawing"`.

### Header label
```
Round {currentPass}: Drawing Phase  →  Round {currentPass}: Guessing Phase
```
Driven by `status.passType`.

### Player card status badge (pending players)

| Condition | Badge |
|-----------|-------|
| `passType === "drawing"`, pending, `secondsLeft > 0` | "Drawing..." with bouncing `edit` icon |
| `passType === "guess"`, pending, `secondsLeft > 0` | "Guessing..." with bouncing `help` or `psychology` icon |
| `passType === "guess"`, pending, `secondsLeft === 0` | "Finish up now!" pulsing `error` badge (error-container bg) |
| Drawing phase at `secondsLeft === 0` | No special badge — auto-submit already happened client-side |
| Submitted | "Submitted!" with `check_circle` (unchanged) |
| Disconnected | "Offline" with `wifi_off` (unchanged) |

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/rounds/[id]/drawing-status/route.ts` | Add `passType` to response |
| `src/components/DrawingCanvas.tsx` | Add `triggerAutoSubmit` prop |
| `src/app/room/[code]/DrawingPhaseScreen.tsx` | Trigger auto-submit at t=0 |
| `src/app/room/[code]/GuessingPhaseScreen.tsx` | Urgency banner at t=0 |
| `src/app/room/[code]/host/HostDrawingScreen.tsx` | Phase-aware labels, t=0 badge, timer fix |

## Not Changed

- `LobbyPlayerList.tsx` — already resets `timerStartedAt` on `pass-advanced` from the previous fix
- `GuessingWaitingScreen.tsx` — only shown after submission, no timer context needed
- `PlayerWaitingScreen.tsx` — same as above
- Server-side expire route — out of scope

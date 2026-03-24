# Timer Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 2-minute round timer meaningful — auto-submit drawings at t=0, show an urgency banner to guessers at t=0, and display phase-aware status on the host dashboard.

**Architecture:** Four independent changes wired together: the drawing-status API grows a `passType` field; `DrawingCanvas` gains a `triggerAutoSubmit` prop that fires `onSubmit` once via a ref guard; `GuessingPhaseScreen` shows a pulsing error banner when time expires; `HostDrawingScreen` uses `passType` to show phase-aware labels and a "Finish up now!" badge at t=0.

**Tech Stack:** Next.js App Router, Drizzle ORM (Neon/Postgres), Ably realtime, React, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-03-24-timer-enforcement-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/app/api/rounds/[id]/drawing-status/route.ts` | Add `passType` field to response |
| `src/app/api/rounds/[id]/drawing-status/__tests__/route.test.ts` | New: tests for `passType` |
| `src/components/DrawingCanvas.tsx` | Add aria-labels to brush buttons; add `triggerAutoSubmit` prop + ref guard |
| `src/components/__tests__/DrawingCanvas.test.tsx` | Fix pre-existing brush slider test; add auto-submit tests |
| `src/app/room/[code]/DrawingPhaseScreen.tsx` | Set `autoSubmit=true` at t=0, pass to canvas |
| `src/app/room/[code]/__tests__/DrawingPhaseScreen.test.tsx` | New: auto-submit integration test |
| `src/app/room/[code]/GuessingPhaseScreen.tsx` | Show urgency banner at t=0 |
| `src/app/room/[code]/__tests__/GuessingPhaseScreen.test.tsx` | Fix pre-existing aria-label test; add urgency banner test |
| `src/app/room/[code]/host/HostDrawingScreen.tsx` | Phase-aware labels + t=0 badge + timer fixes |

---

## Task 1: Add `passType` to drawing-status API

**Files:**
- Modify: `src/app/api/rounds/[id]/drawing-status/route.ts`
- Create: `src/app/api/rounds/[id]/drawing-status/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/rounds/[id]/drawing-status/__tests__/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "../route";
import { NextRequest } from "next/server";

function makeRequest() {
  return new NextRequest("http://localhost/api/rounds/round-1/drawing-status");
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ROUND_ID = "round-1";
const ROOM_ID = "room-1";
const BOOK_ID = "book-1";
const PLAYER_ID = "player-1";

const ROUND_ROW = { id: ROUND_ID, roomId: ROOM_ID, currentPass: 1, timerStartedAt: null };
const BOOK_ROW = { id: BOOK_ID, ownerPlayerId: PLAYER_ID };

// Helper to build a single db.select() mock return value
function makeSelectOnce(result: unknown) {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(result) }) };
}
// For queries that chain .limit()
function makeSelectWithLimit(result: unknown) {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(result) }) }) };
}

describe("GET /api/rounds/[id]/drawing-status", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 404 when round not found", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn().mockReturnValue(makeSelectOnce([]));
    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    expect(res.status).toBe(404);
  });

  it("returns passType 'drawing' when current-pass entry type is drawing", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      // 1) rounds query
      .mockReturnValueOnce(makeSelectOnce([ROUND_ROW]))
      // 2) books query
      .mockReturnValueOnce(makeSelectOnce([BOOK_ROW]))
      // 3) passType query (any entry, any state) — returns drawing
      .mockReturnValueOnce(makeSelectWithLimit([{ type: "drawing" }]))
      // 4) pending entries (isNull filter)
      .mockReturnValueOnce(makeSelectOnce([]))
      // 5) players
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("drawing");
  });

  it("returns passType 'guess' when current-pass entry type is guess", async () => {
    const roundRow = { ...ROUND_ROW, currentPass: 2 };
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      .mockReturnValueOnce(makeSelectOnce([roundRow]))
      .mockReturnValueOnce(makeSelectOnce([BOOK_ROW]))
      .mockReturnValueOnce(makeSelectWithLimit([{ type: "guess" }]))
      .mockReturnValueOnce(makeSelectOnce([]))
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("guess");
  });

  it("falls back to 'drawing' when no entries exist for the current pass", async () => {
    const { db } = await import("@/lib/db");
    (db as unknown as Record<string, unknown>).select = vi.fn()
      .mockReturnValueOnce(makeSelectOnce([ROUND_ROW]))
      .mockReturnValueOnce(makeSelectOnce([BOOK_ROW]))
      .mockReturnValueOnce(makeSelectWithLimit([]))   // no entries yet
      .mockReturnValueOnce(makeSelectOnce([]))
      .mockReturnValueOnce(makeSelectOnce([{ id: PLAYER_ID, nickname: "Alice", isConnected: true }]));

    const res = await GET(makeRequest(), makeParams(ROUND_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.passType).toBe("drawing");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run "src/app/api/rounds/\[id\]/drawing-status/__tests__/route.test.ts"
```

Expected: FAIL — `passType` not in response yet.

- [ ] **Step 3: Implement `passType` in the route**

In `src/app/api/rounds/[id]/drawing-status/route.ts`, after `bookIds` is computed and before the `pendingEntries` query, add:

```ts
// passType: query any entry for current pass (submitted or not, so the filter is absent)
const [passTypeRow] = bookIds.length > 0
  ? await db
      .select({ type: entries.type })
      .from(entries)
      .where(
        and(
          inArray(entries.bookId, bookIds),
          eq(entries.passNumber, round.currentPass)
        )
      )
      .limit(1)
  : [];
const passType: "drawing" | "guess" = passTypeRow?.type ?? "drawing";
```

Add `passType` to the response:

```ts
return NextResponse.json({
  timerStartedAt: round.timerStartedAt?.toISOString() ?? null,
  currentPass: round.currentPass,
  passType,
  pendingNicknames,
  disconnectedNicknames,
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run "src/app/api/rounds/\[id\]/drawing-status/__tests__/route.test.ts"
```

Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/rounds/[id]/drawing-status/route.ts" "src/app/api/rounds/[id]/drawing-status/__tests__/route.test.ts"
git commit -m "feat(api): add passType to drawing-status response"
```

---

## Task 2: `DrawingCanvas` — fix brush test + `triggerAutoSubmit` prop

**Files:**
- Modify: `src/components/DrawingCanvas.tsx`
- Modify: `src/components/__tests__/DrawingCanvas.test.tsx`

### Pre-step: Fix the pre-existing broken brush-size test

The existing test uses `screen.getByRole("slider")` to change brush size, but `DrawingCanvas` uses three `<button>` elements — there is no slider. The test fails today. Fix by adding `aria-label` attributes to the brush buttons and updating the test.

- [ ] **Step 1: Add aria-labels to brush buttons in `DrawingCanvas.tsx`**

Find the three brush size buttons and add `aria-label`:

```tsx
<button
  aria-label="small brush"
  onClick={() => handleBrushChange(2)}
  className={`flex items-center justify-center w-8 h-8 transition-colors ${brushSize <= 2 ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
>
  <div className="w-2 h-2 bg-current rounded-full"></div>
</button>
<button
  aria-label="medium brush"
  onClick={() => handleBrushChange(5)}
  className={`flex items-center justify-center w-8 h-8 transition-colors ${brushSize > 2 && brushSize <= 6 ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
>
  <div className="w-4 h-4 bg-current rounded-full"></div>
</button>
<button
  aria-label="large brush"
  onClick={() => handleBrushChange(10)}
  className={`flex items-center justify-center w-8 h-8 transition-colors ${brushSize > 6 ? 'text-primary' : 'text-on-surface-variant hover:text-primary'}`}
>
  <div className="w-6 h-6 bg-current rounded-full"></div>
</button>
```

- [ ] **Step 2: Fix the existing broken test in `DrawingCanvas.test.tsx`**

Find the test `"uses the selected brush size in the serialized stroke"` and replace the slider interaction:

Old:
```ts
const brushInput = screen.getByRole("slider");
fireEvent.change(brushInput, { target: { value: "12" } });
```

New:
```ts
fireEvent.click(screen.getByRole("button", { name: /large brush/i }));
```

Also update the assertion from `expect(strokes[0].brushSize).toBe(12)` to:
```ts
expect(strokes[0].brushSize).toBe(10);
```

- [ ] **Step 3: Run existing tests to confirm they pass**

```bash
npx vitest run src/components/__tests__/DrawingCanvas.test.tsx
```

Expected: all existing tests PASS.

- [ ] **Step 4: Write the new failing `triggerAutoSubmit` tests**

Add at the bottom of the `describe` block in `src/components/__tests__/DrawingCanvas.test.tsx`:

```ts
it("calls onSubmit with empty strokes when triggerAutoSubmit becomes true with no drawing", () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<DrawingCanvas onSubmit={onSubmit} triggerAutoSubmit={false} />);
  expect(onSubmit).not.toHaveBeenCalled();
  rerender(<DrawingCanvas onSubmit={onSubmit} triggerAutoSubmit={true} />);
  expect(onSubmit).toHaveBeenCalledWith([]);
});

it("calls onSubmit with committed strokes when triggerAutoSubmit becomes true", () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<DrawingCanvas onSubmit={onSubmit} triggerAutoSubmit={false} />);
  const canvas = document.querySelector("canvas")!;

  fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20 });
  fireEvent.mouseMove(canvas, { clientX: 30, clientY: 40 });
  fireEvent.mouseUp(canvas);

  rerender(<DrawingCanvas onSubmit={onSubmit} triggerAutoSubmit={true} />);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  const [strokes] = onSubmit.mock.calls[0];
  expect(strokes).toHaveLength(1);
});

it("does not call onSubmit a second time when triggerAutoSubmit stays true across re-renders", () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<DrawingCanvas onSubmit={onSubmit} triggerAutoSubmit={true} />);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  rerender(<DrawingCanvas onSubmit={onSubmit} triggerAutoSubmit={true} />);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Run to confirm the 3 new tests fail**

```bash
npx vitest run src/components/__tests__/DrawingCanvas.test.tsx
```

Expected: 3 new tests FAIL. All previous tests still PASS.

- [ ] **Step 6: Implement the `triggerAutoSubmit` prop**

In `src/components/DrawingCanvas.tsx`:

1. Add prop to interface:

```ts
interface DrawingCanvasProps {
  onSubmit: (strokes: Stroke[]) => void;
  replayStrokes?: Stroke[];
  disabled?: boolean;
  readOnly?: boolean;
  triggerAutoSubmit?: boolean;  // When flipped true, fires onSubmit(strokes) once
}
```

2. Destructure it:

```ts
export function DrawingCanvas({ onSubmit, replayStrokes, disabled, readOnly, triggerAutoSubmit }: DrawingCanvasProps) {
```

3. After the existing `useRef` declarations, add:

```ts
const autoSubmitted = useRef(false);
// Keep a ref to the latest committed strokes so the auto-submit effect does not
// need `strokes` in its dependency array (which would re-fire on every new stroke).
const strokesRef = useRef(strokes);
useEffect(() => { strokesRef.current = strokes; }, [strokes]);
```

4. Add the auto-submit effect after the replay effect:

```ts
// Auto-submit when the timer expires (triggerAutoSubmit prop flips true).
// The autoSubmitted ref ensures this fires at most once per component lifetime,
// even if the component re-renders with triggerAutoSubmit=true still set.
// strokesRef.current captures the latest committed strokes without adding
// `strokes` to the dependency array (which would re-fire on every stroke added).
useEffect(() => {
  if (!triggerAutoSubmit || autoSubmitted.current) return;
  autoSubmitted.current = true;
  onSubmit(strokesRef.current);
}, [triggerAutoSubmit, onSubmit]);
```

- [ ] **Step 7: Run all tests to confirm they pass**

```bash
npx vitest run src/components/__tests__/DrawingCanvas.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add src/components/DrawingCanvas.tsx src/components/__tests__/DrawingCanvas.test.tsx
git commit -m "feat(canvas): add triggerAutoSubmit prop; fix brush-size button aria-labels"
```

---

## Task 3: `DrawingPhaseScreen` — auto-submit at t=0

**Files:**
- Modify: `src/app/room/[code]/DrawingPhaseScreen.tsx`
- Create: `src/app/room/[code]/__tests__/DrawingPhaseScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/room/[code]/__tests__/DrawingPhaseScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/realtime/client", () => ({
  getAblyClient: vi.fn(() => ({
    channels: {
      get: vi.fn(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        presence: { enter: vi.fn(), leave: vi.fn() },
      })),
    },
  })),
}));

import { DrawingPhaseScreen } from "../DrawingPhaseScreen";

function renderDrawing(overrides: Partial<Parameters<typeof DrawingPhaseScreen>[0]> = {}) {
  const defaults = {
    code: "ABCDEF",
    roundId: "round-1",
    playerId: "player-1",
    timerStartedAt: null,
    players: [],
  };
  return render(<DrawingPhaseScreen {...defaults} {...overrides} />);
}

describe("DrawingPhaseScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-submits when the timer reaches zero", async () => {
    const fetchMock = vi.fn()
      // my-entry fetch returns entryInfo so the submit can proceed
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bookId: "book-1", passNumber: 1, alreadySubmitted: false, incomingContent: "a cat" }),
      })
      // POST /api/entries
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ allSubmitted: false }),
      });
    vi.stubGlobal("fetch", fetchMock);

    // timerStartedAt set to exactly 120 seconds ago so the first tick computes remaining=0
    const timerStartedAt = new Date(Date.now() - 120_000).toISOString();
    renderDrawing({ timerStartedAt });

    // Advance the fake clock so the setInterval tick fires
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      // Transition to PlayerWaitingScreen (which shows "You're all set!")
      expect(screen.getByText(/you're all set/i)).toBeTruthy();
    });

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run "src/app/room/\[code\]/__tests__/DrawingPhaseScreen.test.tsx"
```

Expected: FAIL — no auto-submit occurs.

- [ ] **Step 3: Implement auto-submit in `DrawingPhaseScreen`**

In `src/app/room/[code]/DrawingPhaseScreen.tsx`:

1. Add `autoSubmit` state after the existing state declarations:

```ts
const [autoSubmit, setAutoSubmit] = useState(false);
```

2. In the countdown `useEffect`, update `tick` to trigger auto-submit at zero:

```ts
function tick() {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const remaining = Math.max(0, ROUND_DURATION_SECONDS - elapsed);
  setSecondsLeft(remaining);
  if (remaining === 0) setAutoSubmit(true);
}
```

3. Pass the prop to `DrawingCanvas`:

```tsx
<DrawingCanvas
  onSubmit={handleSubmit}
  disabled={submitting || !entryInfo}
  triggerAutoSubmit={autoSubmit}
/>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run "src/app/room/\[code\]/__tests__/DrawingPhaseScreen.test.tsx"
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/room/[code]/DrawingPhaseScreen.tsx" "src/app/room/[code]/__tests__/DrawingPhaseScreen.test.tsx"
git commit -m "feat(drawing): auto-submit drawing at t=0"
```

---

## Task 4: `GuessingPhaseScreen` — fix pre-existing test + urgency banner

**Files:**
- Modify: `src/app/room/[code]/GuessingPhaseScreen.tsx`
- Modify: `src/app/room/[code]/__tests__/GuessingPhaseScreen.test.tsx`

### Pre-step: Fix the pre-existing broken timer test

The existing test `"displays a countdown timer"` asserts `screen.getByLabelText(/seconds remaining/i)`, but the component has no such `aria-label`. Fix by adding `aria-label="seconds remaining"` to the timer `<span>` in `GuessingPhaseScreen`.

- [ ] **Step 1: Add `aria-label` to the timer span in `GuessingPhaseScreen.tsx`**

Find the timer value span (currently renders `{timeLabel}`):

```tsx
<span className={`font-label font-bold text-xl tracking-widest ${timerUrgent ? "animate-pulse" : ""}`}>
  {timeLabel}
</span>
```

Add `aria-label`:

```tsx
<span
  aria-label="seconds remaining"
  className={`font-label font-bold text-xl tracking-widest ${timerUrgent ? "animate-pulse" : ""}`}
>
  {timeLabel}
</span>
```

- [ ] **Step 2: Run existing tests to confirm the pre-existing failure is fixed**

```bash
npx vitest run "src/app/room/\[code\]/__tests__/GuessingPhaseScreen.test.tsx"
```

Expected: all tests PASS (including the previously failing timer test).

- [ ] **Step 3: Write the new failing urgency banner test**

Add to the `describe` block in `GuessingPhaseScreen.test.tsx`:

```ts
it("shows an urgency banner when the timer reaches zero and player has not submitted", async () => {
  // timerStartedAt 120s ago — timer is already at 0 on first tick
  const timerStartedAt = new Date(Date.now() - 120_000).toISOString();

  vi.useFakeTimers();
  renderGuessing({ timerStartedAt });

  await act(async () => {
    vi.advanceTimersByTime(1100);
  });

  expect(screen.getByText(/time's up/i)).toBeTruthy();
  vi.useRealTimers();
});
```

- [ ] **Step 4: Run to confirm the new test fails**

```bash
npx vitest run "src/app/room/\[code\]/__tests__/GuessingPhaseScreen.test.tsx"
```

Expected: new urgency banner test FAIL. All others PASS.

- [ ] **Step 5: Add the urgency banner to `GuessingPhaseScreen.tsx`**

Add a derived variable after the existing timer calculations:

```ts
const timeExpired = secondsLeft === 0 && !submitted;
```

Add the banner in the JSX after `{error && ...}` and before the Input Section `<div>`:

```tsx
{timeExpired && (
  <div className="w-full max-w-md flex items-center gap-3 px-5 py-4 rounded-xl bg-error-container text-on-error-container border-2 border-error animate-pulse">
    <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>timer_off</span>
    <span className="font-headline font-bold text-lg">Time&apos;s up! Submit your guess now.</span>
  </div>
)}
```

- [ ] **Step 6: Run all tests to confirm they pass**

```bash
npx vitest run "src/app/room/\[code\]/__tests__/GuessingPhaseScreen.test.tsx"
```

Expected: all tests PASS.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add "src/app/room/[code]/GuessingPhaseScreen.tsx" "src/app/room/[code]/__tests__/GuessingPhaseScreen.test.tsx"
git commit -m "feat(guessing): show urgency banner at t=0; fix timer aria-label"
```

---

## Task 5: `HostDrawingScreen` — phase-aware labels, t=0 badge, timer fixes

**Files:**
- Modify: `src/app/room/[code]/host/HostDrawingScreen.tsx`

This component has no existing test file. The changes are UI-only, driven by data already tested at the API layer. Manual verification is sufficient.

- [ ] **Step 1: Fix `ROUND_DURATION_SECONDS` and update `DrawingStatus` type**

Change:
```ts
const ROUND_DURATION_SECONDS = 60;
```
To:
```ts
const ROUND_DURATION_SECONDS = 120;
```

Update the `DrawingStatus` interface:
```ts
interface DrawingStatus {
  timerStartedAt: string | null;
  currentPass: number;
  passType: "drawing" | "guess";
  pendingNicknames: string[];
  disconnectedNicknames: string[];
}
```

Update the initial state:
```ts
const [status, setStatus] = useState<DrawingStatus>({
  timerStartedAt: initialTimer,
  currentPass: 1,
  passType: "drawing",
  pendingNicknames: [],
  disconnectedNicknames: [],
});
```

- [ ] **Step 2: Reset timer optimistically on `pass-advanced`**

`HostDrawingScreen` stores `timerStartedAt` inside the `status` object (not as a separate state variable). `fetchStatus` is a closure defined inside the `useEffect` body — the replacement can call it directly.

Find:
```ts
const onPassAdvanced = () => { fetchStatus(); };
```

Replace with:
```ts
const onPassAdvanced = () => {
  // Optimistically reset countdown so the host timer ticks from 0 immediately,
  // without waiting for the network round-trip. fetchStatus() then overwrites
  // with the authoritative server timestamp.
  setStatus(prev => ({ ...prev, timerStartedAt: new Date().toISOString() }));
  fetchStatus();
};
```

- [ ] **Step 3: Update the header label**

Find:
```tsx
<h1 className="text-on-surface font-headline font-extrabold truncate hidden md:block">Round {status.currentPass}: Drawing Phase</h1>
```

Replace with:
```tsx
<h1 className="text-on-surface font-headline font-extrabold truncate hidden md:block">
  Round {status.currentPass}: {status.passType === "guess" ? "Guessing Phase" : "Drawing Phase"}
</h1>
```

- [ ] **Step 4: Replace the pending player badge with a three-way conditional**

Find the pending badge block (the final `else` branch for a connected, pending player):

```tsx
) : (
  <div className="bg-surface-container-high text-on-surface-variant py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-outline-variant/20">
    <span className="material-symbols-outlined animate-bounce text-sm">edit</span>
    <span className="font-label font-bold uppercase tracking-wider text-xs">Drawing...</span>
  </div>
)}
```

Replace with:

```tsx
) : status.passType === "guess" && timerDone ? (
  <div className="bg-error-container text-on-error-container py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-error animate-pulse">
    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>timer_off</span>
    <span className="font-label font-bold uppercase tracking-wider text-xs">Finish up now!</span>
  </div>
) : status.passType === "guess" ? (
  <div className="bg-surface-container-high text-on-surface-variant py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-outline-variant/20">
    <span className="material-symbols-outlined animate-bounce text-sm">psychology</span>
    <span className="font-label font-bold uppercase tracking-wider text-xs">Guessing...</span>
  </div>
) : (
  <div className="bg-surface-container-high text-on-surface-variant py-3 px-4 rounded-xl flex items-center justify-center gap-3 border border-outline-variant/20">
    <span className="material-symbols-outlined animate-bounce text-sm">edit</span>
    <span className="font-label font-bold uppercase tracking-wider text-xs">Drawing...</span>
  </div>
)}
```

`timerDone` is already computed above as `const timerDone = secondsLeft === 0;`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/room/[code]/host/HostDrawingScreen.tsx"
git commit -m "feat(host): phase-aware labels and finish-up badge on drawing screen"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all tests pass. Fix any failures before continuing.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Fix any errors.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Fix any errors.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(timer): enforce 2-min timer — auto-submit drawings, urgency banner, phase-aware host" --body "$(cat <<'EOF'
## Summary

- **Drawing auto-submit**: `DrawingCanvas` gains a `triggerAutoSubmit` prop; `DrawingPhaseScreen` sets it at t=0. Uses a `useRef` guard to fire `onSubmit` exactly once per component lifetime.
- **Guessing urgency banner**: `GuessingPhaseScreen` shows a pulsing "Time's up! Submit your guess now." banner at t=0 while the input stays functional.
- **Host phase-aware dashboard**: `HostDrawingScreen` now shows "Drawing Phase" vs "Guessing Phase" header, "Guessing..." badge for pending guessers, and a pulsing "Finish up now!" badge at t=0 for unsubmitted guessers.
- **`drawing-status` API**: Returns `passType: "drawing" | "guess"` (queries entry type for current pass without `submittedAt` filter; falls back to `"drawing"`).
- **Host timer fix**: `ROUND_DURATION_SECONDS` bumped to 120; countdown resets optimistically on `pass-advanced`.
- **Pre-existing fixes**: Brush-size buttons get `aria-label`; `GuessingPhaseScreen` timer element gets `aria-label="seconds remaining"`.

## Test plan

- [ ] Play a full drawing round — confirm drawing auto-submits when timer hits 0
- [ ] Play a guessing round, leave guess blank — confirm "Time's up!" banner appears at t=0 and input is still usable
- [ ] Watch host screen during drawing phase — "Drawing Phase" label and "Drawing..." badge
- [ ] Watch host screen during guessing phase — "Guessing Phase" label and "Guessing..." badge; "Finish up now!" on pending players at t=0
- [ ] `npm test` — all tests pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

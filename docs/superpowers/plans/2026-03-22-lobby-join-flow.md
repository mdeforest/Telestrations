# Lobby Join Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify the lobby flow so the desktop is a read-only status dashboard, the phone host owns game controls, and the host QR is one-time-use.

**Architecture:** Five targeted edits across schema, one route, and three UI components. No new routes. A new nullable `host_phone_connected_at` DB column gates the host QR to a single use. The home page redirects host creation to the desktop view and pre-fills room code from `?code=`. UI changes are cosmetic-minimal — existing layout and styles are preserved throughout.

**Tech Stack:** Next.js App Router, Drizzle ORM + Neon Postgres, Ably realtime, Vitest + Testing Library, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-22-lobby-join-flow-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `hostPhoneConnectedAt` nullable timestamp to `rooms` table |
| `drizzle/<migration>.sql` | Generated migration — do not hand-edit |
| `src/app/room/[code]/connect/route.ts` | Add one-time-use guard with race-safe conditional update |
| `src/app/room/[code]/connect/__tests__/route.test.ts` | Extend existing tests for the new guard |
| `src/app/page.tsx` | Redirect create → `/host`; pre-fill `joinCode` from `?code=` param |
| `src/app/room/[code]/host/HostLobby.tsx` | New left panel (player QR + fallback + blurred host QR); remove dead state/handlers; read-only footer |
| `src/app/room/[code]/LobbyPlayerList.tsx` | Remove fake QR placeholder; add host badge |

---

## Task 1: Add `hostPhoneConnectedAt` to schema and generate migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/<generated>.sql` (via `npm run db:generate`)

- [ ] **Step 1: Add column to schema**

In `src/lib/db/schema.ts`, add one field to the `rooms` table definition (after `revealEntryIndex`):

```ts
hostPhoneConnectedAt: timestamp("host_phone_connected_at", { withTimezone: true }),
```

The full rooms table block will have this as the last field before `createdAt`.

- [ ] **Step 2: Generate the migration SQL file (for version control)**

```bash
cd /Users/mdeforest/Documents/Personal/Projects/telestrations
npm run db:generate
```

Expected: a new `.sql` file appears in `drizzle/` containing `ALTER TABLE "rooms" ADD COLUMN "host_phone_connected_at" timestamp with time zone;`. This file is for version history — it is NOT applied by `db:push`.

- [ ] **Step 3: Apply schema to the database**

```bash
npm run db:push
```

`db:push` reads `schema.ts` directly and applies the diff — it does not run the generated SQL file. Both steps are needed: `db:generate` for the migration record, `db:push` to apply. Requires `.env.local` with `DATABASE_URL`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): add hostPhoneConnectedAt column to rooms"
```

---

## Task 2: Add one-time-use guard to the connect route

**Files:**
- Modify: `src/app/room/[code]/connect/route.ts`
- Modify: `src/app/room/[code]/connect/__tests__/route.test.ts`

### Step 2a: Write failing tests first

- [ ] **Step 1: Update the mock setup in the test file**

> **Note on existing tests:** All existing test room rows use `{ id: "room-1", code: "ABCDEF" }` without `hostPlayerId` or `hostPhoneConnectedAt`. After the guard is added, those tests still pass because `pid !== undefined` will not equal `room.hostPlayerId` (which is `undefined`), so the guard is skipped. However, update all room row fixtures to include `hostPlayerId: "host-1"` and `hostPhoneConnectedAt: null` for clarity and to avoid future fragility.

The existing `db` mock only covers `select`. Add `update` to it. Replace the entire mock setup block:

```ts
const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  selectWhere: vi.fn(),
  updateReturning: vi.fn(),
  ablyPublish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: mocks.cookieSet }),
  headers: () => Promise.resolve(new Headers({ host: "localhost:3000" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mocks.selectWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mocks.updateReturning }) }) }),
  },
}));

vi.mock("@/lib/realtime/server", () => ({
  getAblyRest: () => ({
    channels: { get: () => ({ publish: mocks.ablyPublish }) },
  }),
}));
```

- [ ] **Step 2: Update existing happy-path test to include new fields and update mock**

The existing "sets playerId cookie..." test needs the room row to include `hostPlayerId` and `hostPhoneConnectedAt`, and must mock the update call. Replace that test:

```ts
it("sets playerId cookie, publishes Ably event, and redirects when valid", async () => {
  mocks.selectWhere
    .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }])
    .mockResolvedValueOnce([{ id: "player-1", roomId: "room-1" }]);
  mocks.updateReturning.mockResolvedValueOnce([{ id: "room-1" }]);

  const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toMatch(/\/room\/ABCDEF/);
  expect(mocks.cookieSet).toHaveBeenCalledWith("playerId", "player-1", { httpOnly: true, path: "/" });
  expect(mocks.ablyPublish).toHaveBeenCalledWith("host-phone-connected", null);
});
```

Also update the "normalises lowercase" test the same way (add the new room fields + `updateReturning` mock).

- [ ] **Step 3: Add new test — 409 when host QR already claimed**

```ts
it("returns 409 when the host QR has already been used", async () => {
  mocks.selectWhere.mockResolvedValueOnce([{
    id: "room-1",
    code: "ABCDEF",
    hostPlayerId: "player-1",
    hostPhoneConnectedAt: new Date(),
  }]);
  const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/already been used/i);
});
```

- [ ] **Step 4: Add new test — 409 on race condition (update returns 0 rows)**

```ts
it("returns 409 when conditional update claims 0 rows (race condition)", async () => {
  mocks.selectWhere
    .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "player-1", hostPhoneConnectedAt: null }])
    .mockResolvedValueOnce([{ id: "player-1", roomId: "room-1" }]);
  mocks.updateReturning.mockResolvedValueOnce([]); // 0 rows — race lost

  const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/already been used/i);
});
```

- [ ] **Step 5: Add new test — 409 when a non-host scans the already-claimed host QR URL**

The `pid` in the host QR URL is always the host's player ID. If someone scans it after it's claimed, the `pid` matches `room.hostPlayerId` and `hostPhoneConnectedAt` is set → 409. This test is identical to Step 3 but confirms the guard works regardless of who is holding the phone:

```ts
it("returns 409 when the host QR is scanned a second time by any user", async () => {
  mocks.selectWhere.mockResolvedValueOnce([{
    id: "room-1",
    code: "ABCDEF",
    hostPlayerId: "player-1",         // the pid in the QR URL
    hostPhoneConnectedAt: new Date(), // already claimed
  }]);
  // Any phone scanning this URL sends pid=player-1 (the host's ID embedded in the QR)
  const res = await GET(makeReq("ABCDEF", "player-1"), makeParams("ABCDEF"));
  expect(res.status).toBe(409);
});
```

- [ ] **Step 6: Add new test — non-host player connect still works (no update called)**

Non-host players don't have the guard applied (the guard only fires when `pid === room.hostPlayerId`). Confirm regular player connect still works:

```ts
it("allows a non-host player to connect without the one-time guard", async () => {
  mocks.selectWhere
    .mockResolvedValueOnce([{ id: "room-1", code: "ABCDEF", hostPlayerId: "host-1", hostPhoneConnectedAt: null }])
    .mockResolvedValueOnce([{ id: "player-2", roomId: "room-1" }]);
  // No updateReturning mock — update should NOT be called for non-host

  const res = await GET(makeReq("ABCDEF", "player-2"), makeParams("ABCDEF"));
  expect(res.status).toBe(307);
  expect(mocks.updateReturning).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run tests — confirm they fail**

```bash
npm test -- src/app/room/\\[code\\]/connect
```

Expected: several FAILs on the new tests (guard logic doesn't exist yet).

### Step 2b: Implement the guard

- [ ] **Step 8: Update the connect route**

Replace the contents of `src/app/room/[code]/connect/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { players, rooms } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getAblyRest } from "@/lib/realtime/server";
import { channels } from "@/lib/realtime/channels";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const upperCode = code.toUpperCase();

  const pid = req.nextUrl.searchParams.get("pid");
  if (!pid) {
    return NextResponse.json({ error: "pid is required" }, { status: 404 });
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.code, upperCode));
  if (!room) {
    return NextResponse.json({ error: "room not found" }, { status: 404 });
  }

  // One-time-use guard for the host QR.
  if (pid === room.hostPlayerId) {
    if (room.hostPhoneConnectedAt != null) {
      return NextResponse.json(
        { error: "This host QR has already been used. Ask the host to show you the player join code instead." },
        { status: 409 }
      );
    }
    // Race-safe claim: only succeeds if still unclaimed.
    const claimed = await db
      .update(rooms)
      .set({ hostPhoneConnectedAt: new Date() })
      .where(and(eq(rooms.code, upperCode), isNull(rooms.hostPhoneConnectedAt)))
      .returning({ id: rooms.id });
    if (claimed.length === 0) {
      return NextResponse.json(
        { error: "This host QR has already been used. Ask the host to show you the player join code instead." },
        { status: 409 }
      );
    }
  }

  const [player] = await db.select().from(players).where(eq(players.id, pid));
  if (!player || player.roomId !== room.id) {
    return NextResponse.json({ error: "player not found in room" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set("playerId", pid, { httpOnly: true, path: "/" });

  await getAblyRest()
    .channels.get(channels.roomPlayers(upperCode))
    .publish("host-phone-connected", null);

  const reqHeaders = await headers();
  const host = reqHeaders.get("host") ?? "localhost:3000";
  const proto = process.env.NODE_ENV === "production" ? "https" : "http";
  return NextResponse.redirect(`${proto}://${host}/room/${upperCode}`);
}
```

- [ ] **Step 9: Run tests — confirm they pass**

```bash
npm test -- src/app/room/\\[code\\]/connect
```

Expected: all tests PASS.

- [ ] **Step 10: Run full test suite**

```bash
npm test
```

Expected: all 210+ tests PASS.

- [ ] **Step 11: Commit**

```bash
git add src/app/room/[code]/connect/route.ts src/app/room/[code]/connect/__tests__/route.test.ts
git commit -m "feat(connect): add one-time-use guard for host QR"
```

---

## Task 3: Home page — redirect create to `/host` and pre-fill room code

**Files:**
- Modify: `src/app/page.tsx`

No new test file needed — `page.tsx` is a client component with no route handler to unit-test. Verify manually.

- [ ] **Step 1: Change `handleCreate` redirect**

In `src/app/page.tsx`, find line 24:
```ts
router.push(`/room/${data.code}`);
```
Change to:
```ts
router.push(`/room/${data.code}/host`);
```

- [ ] **Step 2: Add `?code=` pre-fill via `useEffect`**

Add a `useEffect` after the existing state declarations that reads `?code=` from the URL and pre-fills `joinCode`:

```ts
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) setJoinCode(code.toUpperCase());
}, []);
```

- [ ] **Step 3: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): redirect create to /host and pre-fill room code from ?code="
```

---

## Task 4: HostLobby — new left panel, dead code removal, read-only footer

**Files:**
- Modify: `src/app/room/[code]/host/HostLobby.tsx`

This is the largest single edit. Read the current file carefully before making changes.

- [ ] **Step 1: Remove dead state and handlers**

Delete these items from `HostLobby.tsx`:
- `const [showQr, setShowQr] = useState(false);` — line 50
- `const [starting, setStarting] = useState(false);` — line 54
- `const [startError, setStartError] = useState<string | null>(null);` — line 55
- `const canStart = playerList.length >= 4;` — line 57
- The entire `async function handleStart() { ... }` block — lines 59–77

Keep: `phoneConnected` state (line 49) and its Ably subscription (`host-phone-connected`).

- [ ] **Step 2: Extend `urlInfo` to include `playerJoinUrl`**

`HostLobby.tsx` already computes `connectUrl` inside a `useEffect` (to safely access `window.location`). Extend it to also compute `playerJoinUrl` at the same time. Update the `urlInfo` state type and the `useEffect`:

```ts
const [urlInfo, setUrlInfo] = useState({ connectUrl: "", playerJoinUrl: "", isLocalhost: false });

useEffect(() => {
  setUrlInfo({
    connectUrl: `${window.location.origin}/room/${code}/connect?pid=${hostPlayerId}`,
    playerJoinUrl: `${window.location.origin}/?code=${code}`,
    isLocalhost:
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1",
  });
}, [code, hostPlayerId]);
```

> **Important:** Never access `window.location.origin` directly in JSX — it crashes during Next.js SSR prerender. Always read it inside `useEffect` and store into state, as shown above.

- [ ] **Step 3: Replace the left panel**

The current left panel (the `<section>` with `w-full lg:w-1/3`) renders a single QR pointing at `connectUrl` labeled "Scan to Join!". Replace its contents with the three-zone layout below. Keep the `<section>` wrapper and its existing className intact — only replace the inner JSX.

Zone 1 — player join QR (prominent). Uses `urlInfo.playerJoinUrl` — safe because it's set in `useEffect`:
```tsx
<div className="bg-surface-container-lowest rounded-xl p-10 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant/30 flex-grow relative min-h-[300px]">
  {urlInfo.playerJoinUrl ? (
    <QRCodeSVG value={urlInfo.playerJoinUrl} size={192} className="mb-6 opacity-90" />
  ) : (
    <div className="w-48 h-48 bg-on-surface rounded-lg p-4 grid grid-cols-4 grid-rows-4 gap-2 opacity-10 mb-6">
      <div className="bg-surface col-span-1 row-span-1"></div>
      <div className="bg-surface col-span-1 row-span-1"></div>
      <div className="bg-surface col-span-1 row-span-1"></div>
      <div className="bg-surface col-span-2 row-span-2"></div>
    </div>
  )}
  <h2 className="font-headline text-2xl font-extrabold text-primary mb-1">Scan to Join!</h2>
  <p className="text-on-surface-variant max-w-xs mx-auto text-sm font-medium text-center">Point your camera here to join the game on your phone.</p>
</div>
```

Zone 2 — manual fallback:
```tsx
<div className="bg-surface-container-lowest rounded-xl px-6 py-4 flex flex-col items-center text-center border border-outline-variant/20">
  <p className="text-xs text-on-surface-variant font-medium mb-1">Or go to <span className="font-bold text-on-surface">telestrations.com</span> and enter</p>
  <span className="font-headline text-3xl font-black tracking-widest text-on-surface">{code}</span>
</div>
```

Zone 3 — host QR (blurred until hover, hidden once connected):
```tsx
{!phoneConnected ? (
  <div
    className="rounded-xl px-6 py-4 flex flex-col items-center text-center border border-dashed border-outline-variant/20 cursor-pointer group"
    onMouseEnter={(e) => (e.currentTarget.querySelector<HTMLDivElement>(".host-qr-inner")!.style.filter = "none")}
    onMouseLeave={(e) => (e.currentTarget.querySelector<HTMLDivElement>(".host-qr-inner")!.style.filter = "blur(8px)")}
  >
    <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-3">👑 Host — hover to reveal your controller QR</p>
    <div className="host-qr-inner transition-all" style={{ filter: "blur(8px)" }}>
      {urlInfo.connectUrl ? (
        <QRCodeSVG value={urlInfo.connectUrl} size={96} />
      ) : null}
    </div>
  </div>
) : (
  <div className="rounded-xl px-6 py-4 flex flex-col items-center text-center border border-outline-variant/20">
    <p className="text-xs font-bold text-green-600 uppercase tracking-widest">✓ Host phone connected</p>
  </div>
)}
```

- [ ] **Step 3: Update the footer — read-only settings**

In the footer, replace the interactive rounds stepper and scoring mode toggle with read-only text. Find the `<div className="flex flex-col items-center md:items-start">` block that contains the rounds and scoring controls and replace it with:

```tsx
<div className="flex flex-col items-center md:items-start">
  <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline-variant font-bold mb-3">Game Settings</span>
  <div className="flex gap-6 items-center">
    <div className="flex flex-col items-center md:items-start">
      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Rounds</span>
      <span className="font-headline text-2xl font-extrabold text-on-surface">{numRounds}</span>
    </div>
    <div className="h-10 w-px bg-outline-variant/30"></div>
    <div className="flex flex-col items-center md:items-start">
      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1">Scoring Mode</span>
      <span className="font-headline text-xl font-extrabold text-on-surface capitalize">{scoringMode}</span>
    </div>
  </div>
  <span className="text-[10px] text-outline-variant mt-2 font-label">Set on host phone</span>
</div>
```

- [ ] **Step 4: Remove Start button and error banner from footer**

Delete the entire `<div className="flex items-center relative">` block containing the Start Game button and the `startError` toast. Also delete the `!canStart` warning banner fixed at the bottom of the page.

The footer's right side should now only contain the Room Code display.

- [ ] **Step 5: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Fix any errors before continuing.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/room/[code]/host/HostLobby.tsx
git commit -m "feat(host-lobby): read-only desktop dashboard with player join QR"
```

---

## Task 5: LobbyPlayerList — remove fake QR, add host badge

**Files:**
- Modify: `src/app/room/[code]/LobbyPlayerList.tsx`

- [ ] **Step 1: Remove the fake QR placeholder panel**

In the `isHost` branch (starting around line 204), the left column (`lg:col-span-7`) contains the player grid. The right column (`lg:col-span-5`) has two sub-branches: the `isHost` sub-branch shows a QR placeholder with a CSS grid of `<div>`s inside a `bg-surface/80 backdrop-blur-sm` overlay. Delete the entire fake QR container div (the one with `absolute inset-0` overlay and the plain `div` grid beneath it). The outer `<div className="bg-surface-container-lowest rounded-xl p-10 ...">` wrapper can be removed entirely since it only held the fake QR.

The `isHost` right column should now start directly with the settings panel (`<div className="bg-surface-container-lowest p-8 ...">`) without the QR panel above it.

- [ ] **Step 2: Add the host badge**

At the very top of the `isHost` branch return (before `<main ...>`), add the badge as the first child inside the `<>` fragment:

```tsx
<div className="px-4 pt-4 flex justify-center">
  <span className="bg-primary text-on-primary text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full font-label">
    👑 You're the Host
  </span>
</div>
```

- [ ] **Step 3: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Fix any errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/room/[code]/LobbyPlayerList.tsx
git commit -m "feat(lobby): remove fake QR placeholder, add host badge to phone host view"
```

---

## Final checks

- [ ] Run `npm run typecheck && npm run lint && npm test` — all must pass clean
- [ ] Manually verify the flow end-to-end in the browser (requires `.env.local`)
- [ ] Push branch and open PR

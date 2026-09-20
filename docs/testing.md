# Testing

Two layers: Vitest unit tests for logic, Playwright end-to-end tests for the
real UI. GitHub Actions runs both on every push to `main` and every pull
request.

## Unit tests

```bash
npm test          # one run
npm run test:watch # re-run on change
```

Vitest, configured in `vitest.config.ts`: `jsdom` environment, `globals: false`
(so every spec imports `describe` / `it` / `expect` / `vi` from `vitest`
explicitly and `tsconfig.app.json` needs no extra `types` entry), and
`src/test/setup.ts` for the `@testing-library/jest-dom` matchers.
`src/**/*.test.{ts,tsx}` and `supabase/**/*.test.ts` are collected — `e2e/`
belongs to Playwright.

The config also injects placeholder `VITE_SUPABASE_*` values, because
`src/lib/supabase/client.ts` throws at import time without them. Nothing ever
connects: Supabase is unreachable from a dev machine and from CI, so every test
that exercises the data layer mocks it.

| File | Covers |
| --- | --- |
| `src/lib/dates.test.ts` | ISO date arithmetic, weekday/weekend, the header label formats, month and week snapping, `generateDateRange` — all on fixed dates, never on "today" |
| `src/lib/layout.test.ts` | `dateToX`/`xToDate` round trips and day snapping at each zoom width, `assignTracks` (touching ranges overlap, track reuse, ordering), `computeRowHeight`, `computeHeaderSegments` and `computeTickOffsets` across a month boundary, `showsWeekendShading`, `expansionDaysForWidth`, `computeRowHeight`'s reserved-height parameter and `rangeGeometry`'s clipping |
| `src/lib/capacity.test.ts` | `countDays` (weekdays only, weekends counted, inverted ranges, cross-checked against `isWeekend` day by day), `computeCapacity` for blocks straddling a sprint boundary, weekend-only blocks, parallel blocks pushing load past 1, an empty member list, a member with no blocks and `workingDaysOnly: false`, plus the team roll-up, `memberFigures`, `loadLevel` thresholds and the two formatters |
| `src/lib/sprints.test.ts` | `computeSprintBoundaries` before, after and straddling the anchor, off-grid ranges and non-dividing sprint lengths, the range-relative sprint numbering, and `getSprintLabel` |
| `src/store/useAppStore.test.ts` | the store's optimistic write / rollback / conflict behaviour with `members`, `blocks`, `sprintConfig` and `boards` mocked via `vi.mock`, including board create/rename/delete, the persisted current board, and that every insert is stamped with it |
| `src/lib/supabase/mappers.test.ts` | the snake_case-to-frontend row mappers, including the role lifted out of the `board_members` join |
| `src/artifact/backend.test.ts` | `migrateLocalData`: pre-boards localStorage is adopted into one board named "Team" rather than dropped |
| `src/components/Sidebar/ZoomControl.test.tsx` | one React Testing Library smoke test: `aria-pressed` tracks the store's zoom and clicking changes it |
| `src/lib/colors.test.ts` | the palette in `src/lib/colors.ts` matches the `blocks_color_valid` CHECK constraint parsed out of `supabase/migrations/006_constraints.sql` |
| `supabase/migrations.test.ts` | applies every migration to an in-memory Postgres (PGlite) and asserts the constraints, audit trigger, seed data and RLS — see `docs/database.md` |
| `src/components/DataLoader/FirstBoardScreen.test.tsx` | the "create your first board" screen creates the named board and makes it current |

Notes for anyone adding to these:

- **Store tests** snapshot the store's initial state at module load and restore
  it with `useAppStore.setState(initialState, true)` in `beforeEach`, so no
  state leaks between tests. Store actions fire their promises without
  returning them, so a test waits with a `flush()` helper (`setTimeout(…, 0)`)
  before asserting on what the rejection or resolution did. The conflict paths
  assert the `CONFLICT_*_MESSAGE` toast and that the refetched server row — not
  the local edit and not the stale value — is what ends up in state.
- **Component tests** must call `cleanup()` themselves in `afterEach`:
  Testing Library only installs its automatic cleanup when Vitest globals are
  on, and here they are off.
- **The migration test** must keep its `// @vitest-environment node` pragma: it
  boots Postgres in WebAssembly and cannot run in jsdom. Its first assertion
  checks that.
- Sprint numbering from `computeSprintBoundaries` is **range-relative**: the
  first boundary in the requested range is always `1`, regardless of the
  anchor. `getSprintLabel` is the one that numbers relative to today.

## End-to-end tests

```bash
npm run test:e2e
```

This drives the app in headless Chromium with Playwright. It starts its own
dev server on port 5175 running the **artifact build**
(`vite --config vite.artifact.config.ts`), which swaps the Supabase data
modules for a localStorage-backed implementation — so there is no login screen,
no network, and no shared database to reset between runs.

Specs live in `e2e/`:

| File | Covers |
| --- | --- |
| `e2e/boards.spec.ts` | creating a second board, isolation of members / blocks / sprint settings between boards, renaming, deleting with confirm, the last board surviving a reload |
| `e2e/members.spec.ts` | adding, renaming, deleting and reordering members |
| `e2e/blocks.spec.ts` | creating blocks (drag and double-click), moving, resizing, editing, duplicating, deleting |
| `e2e/app.spec.ts` | sprint settings, persistence across reload, offline behaviour |
| `e2e/capacity.spec.ts` | the Capacity toggle: off by default, header band totals, a lane reading `5 / 10 d` for a five-weekday block in the current sprint, parallel blocks turning the bar `over`, the strip reserving room above the blocks, bar-only at quarter zoom, and the choice surviving a reload |
| `e2e/helpers.ts` | shared fixture and drag/geometry helpers |

Each test gets a fresh browser context and clears `localStorage` before it
starts, so state never leaks between tests.

Useful flags:

```bash
npm run test:e2e -- --headed              # watch it run in a real browser
npm run test:e2e -- --debug               # step through with the inspector
npm run test:e2e -- e2e/blocks.spec.ts    # one file
npm run test:e2e -- -g "resizes a block"  # one test by name
PW_PORT=5193 npm run test:e2e             # run on another port
npx playwright show-report                # last HTML report, if one was generated
```

If the dev server is already running on port 5175, Playwright reuses it
locally (`reuseExistingServer: !process.env.CI`); in CI it always starts its
own and retries failing tests twice, keeping a trace of the first retry and
writing an HTML report to `playwright-report/`.

Because of that reuse, a second checkout of this repo serving *its* artifact
build on 5175 would silently be the thing under test. `PW_PORT` moves both the
run and the dev server it starts, which is how to test two checkouts at once.

### Browsers

The Chromium build Playwright needs is pre-installed in this environment at
`/opt/pw-browsers` with `PLAYWRIGHT_BROWSERS_PATH` pointing at it, so
`npx playwright install` should not be run here. On a machine without it,
`npx playwright install chromium` fetches the browser matching the pinned
`@playwright/test` version (1.56.1).

### Test hooks in the app

The tests prefer accessible locators (roles, labels, placeholders, titles,
text). A few elements have no accessible handle, so they carry a `data-testid`:
`member-row`, `swimlane`, `block`, `resize-left` / `resize-right`,
`board-switcher`, `board-settings`, `board-member`, `first-board-screen`,
`capacity-total`, `capacity-segment` and `member-load`.
Keep those attributes when editing the components.

The e2e suite runs against the artifact build, which auto-creates one board
named "Team" on a blank slate (membership is not enforced there — artifact
sharing is), so every spec starts on that board. The Supabase build instead
shows the "create your first board" screen.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull
request, on `ubuntu-latest` with Node 22 and the npm cache enabled. One job,
in order:

1. `npm ci`
2. `npm run lint`
3. `npx tsc -b`
4. `npm test`
5. `npm run build`
6. `npm run build:artifact`
7. `npx playwright install --with-deps chromium`
8. `npm run test:e2e` (with `CI=1`)

If anything fails, `playwright-report/` is uploaded as a build artifact so the
failing e2e run can be inspected from the workflow summary.

No secrets are needed: the unit tests mock the data layer and the e2e suite
drives the localStorage-backed artifact build, so CI never talks to Supabase.
`npx playwright install` is correct in CI (the pre-installed browser at
`/opt/pw-browsers` only exists in this dev environment).

A `concurrency` group keyed on `github.ref` with `cancel-in-progress: true`
means a new push to a branch cancels the run still in flight for it.

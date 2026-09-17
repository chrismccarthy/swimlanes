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
`src/test/setup.ts` for the `@testing-library/jest-dom` matchers. Only
`src/**/*.test.{ts,tsx}` is collected — `e2e/` belongs to Playwright.

The config also injects placeholder `VITE_SUPABASE_*` values, because
`src/lib/supabase/client.ts` throws at import time without them. Nothing ever
connects: Supabase is unreachable from a dev machine and from CI, so every test
that exercises the data layer mocks it.

| File | Covers |
| --- | --- |
| `src/lib/dates.test.ts` | ISO date arithmetic, weekday/weekend, the header label formats, month and week snapping, `generateDateRange` — all on fixed dates, never on "today" |
| `src/lib/layout.test.ts` | `dateToX`/`xToDate` round trips and day snapping at each zoom width, `assignTracks` (touching ranges overlap, track reuse, ordering), `computeRowHeight`, `computeHeaderSegments` and `computeTickOffsets` across a month boundary, `showsWeekendShading`, `expansionDaysForWidth` |
| `src/lib/sprints.test.ts` | `computeSprintBoundaries` before, after and straddling the anchor, off-grid ranges and non-dividing sprint lengths, the range-relative sprint numbering, and `getSprintLabel` |
| `src/store/useAppStore.test.ts` | the store's optimistic write / rollback / conflict behaviour with `members`, `blocks` and `sprintConfig` mocked via `vi.mock` |
| `src/components/Sidebar/ZoomControl.test.tsx` | one React Testing Library smoke test: `aria-pressed` tracks the store's zoom and clicking changes it |

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
| `e2e/members.spec.ts` | adding, renaming, deleting and reordering members |
| `e2e/blocks.spec.ts` | creating blocks (drag and double-click), moving, resizing, editing, duplicating, deleting |
| `e2e/app.spec.ts` | sprint settings, persistence across reload, offline behaviour |
| `e2e/helpers.ts` | shared fixture and drag/geometry helpers |

Each test gets a fresh browser context and clears `localStorage` before it
starts, so state never leaks between tests.

Useful flags:

```bash
npm run test:e2e -- --headed              # watch it run in a real browser
npm run test:e2e -- --debug               # step through with the inspector
npm run test:e2e -- e2e/blocks.spec.ts    # one file
npm run test:e2e -- -g "resizes a block"  # one test by name
npx playwright show-report                # last HTML report, if one was generated
```

If the dev server is already running on port 5175, Playwright reuses it
locally (`reuseExistingServer: !process.env.CI`); in CI it always starts its
own and retries failing tests twice, keeping a trace of the first retry and
writing an HTML report to `playwright-report/`.

### Browsers

The Chromium build Playwright needs is pre-installed in this environment at
`/opt/pw-browsers` with `PLAYWRIGHT_BROWSERS_PATH` pointing at it, so
`npx playwright install` should not be run here. On a machine without it,
`npx playwright install chromium` fetches the browser matching the pinned
`@playwright/test` version (1.56.1).

### Test hooks in the app

The tests prefer accessible locators (roles, labels, placeholders, titles,
text). A few elements have no accessible handle, so they carry a `data-testid`:
`member-row`, `swimlane`, `block` and `resize-left` / `resize-right`. Keep
those attributes when editing the components.

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

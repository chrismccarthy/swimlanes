/**
 * Test-only render-crash hook for the Timeline error boundary e2e spec.
 * Visiting `?crash=timeline` makes `Timeline` throw on render; the flag is
 * read once at module load, and `resetTimelineCrashHook` (wired to the
 * boundary's "Try again") turns it back off without needing the query flag
 * cleared first. `import.meta.env.DEV` is a build-time constant, so this
 * whole branch is dead code (and stripped) in production builds.
 */
let crashOnRender = import.meta.env.DEV || import.meta.env.MODE === 'test'
  ? typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('crash') === 'timeline'
  : false;

export function shouldCrashTimelineOnRender(): boolean {
  return crashOnRender;
}

/** Test-only: clears the `?crash=timeline` render hook. */
export function resetTimelineCrashHook(): void {
  crashOnRender = false;
}

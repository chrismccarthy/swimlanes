// Artifact-build replacement for lib/supabase/icsTokens.ts (same exports).
//
// A subscribable feed needs a server to serve it, and this build has none: the
// artifact sandbox has no network access and no Supabase project behind it. The
// rejection message is shown to the user as a toast.

export const FEEDS_UNAVAILABLE_MESSAGE =
  'Calendar feeds need the hosted version — download the .ics file instead';

export function createIcsFeedUrl(): Promise<string> {
  return Promise.reject(new Error(FEEDS_UNAVAILABLE_MESSAGE));
}

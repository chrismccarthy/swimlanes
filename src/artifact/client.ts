// Artifact-build replacement for lib/supabase/client.ts.
// The Login screen is never shown in the artifact build (see AuthContext.tsx),
// but it still imports the client, so provide an inert stand-in instead of
// bundling supabase-js and requiring env vars.
export const supabase = {
  auth: {
    signInWithOAuth: async () => ({ data: null, error: null }),
    signInWithPassword: async () => ({
      data: null,
      error: { message: 'Sign-in is not available in this preview.' },
    }),
  },
};

// Artifact-build replacement for contexts/AuthContext.tsx.
// Access to the published page is controlled by artifact sharing, so there
// is no sign-in step; every viewer is treated as signed in.
import { useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '../contexts/authContextValue';
import type { AuthContextValue } from '../contexts/authContextValue';

const VIEWER_KEY = 'swimlanes.artifact.viewerId';

function viewerId(): string {
  try {
    const existing = localStorage.getItem(VIEWER_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VIEWER_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [value] = useState<AuthContextValue>(() => {
    const user = { id: viewerId() } as unknown as User;
    const session = { user } as unknown as Session;
    return { session, user, loading: false, signOut: async () => {} };
  });

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

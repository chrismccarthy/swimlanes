import { useCallback } from 'react';
import { supabase } from '../../lib/supabase/client';
import styles from './Login.module.css';

export function Login() {
  const handleSignIn = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: { hd: 'evenlydistributed.xyz' },
        redirectTo: window.location.origin,
      },
    });
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Swimlanes</h1>
        <p className={styles.subtitle}>Team Planning Tool</p>
        <button className={styles.googleBtn} onClick={handleSignIn}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

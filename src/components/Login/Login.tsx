import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import styles from './Login.module.css';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: { hd: 'evenlydistributed.xyz' },
        redirectTo: window.location.origin,
      },
    });
  }, []);

  const handleEmailSignIn = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
  }, [email, password]);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Swimlanes</h1>
        <p className={styles.subtitle}>Team Planning Tool</p>
        <button className={styles.googleBtn} onClick={handleGoogleSignIn}>
          Sign in with Google
        </button>
        <div className={styles.divider}><span>or</span></div>
        <form className={styles.form} onSubmit={handleEmailSignIn}>
          <input
            className={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.emailBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in with Email'}
          </button>
        </form>
      </div>
    </div>
  );
}

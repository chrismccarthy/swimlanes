import { supabase } from './client';

interface TokenRow {
  token: string;
}

/**
 * Mint a subscription token for one member and return the feed URL for it.
 *
 * The URL points at the `ics` edge function, which reads the token with the
 * service role key (see supabase/functions/ics/index.ts). Tokens are
 * capability URLs: anyone holding one can read that member's blocks, so they
 * are only ever handed to the person who asked for them.
 */
export async function createIcsFeedUrl(memberId: string, userId: string): Promise<string> {
  // RLS requires created_by = auth.uid(), so a missing id could only ever fail.
  if (!userId) throw new Error('Sign in again to create a calendar feed URL');

  const { data, error } = await supabase
    .from('ics_tokens')
    .insert({ member_id: memberId, created_by: userId })
    .select('token')
    .single();
  if (error) throw error;

  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const params = new URLSearchParams({ member: memberId, token: (data as TokenRow).token });
  return `${base}/functions/v1/ics?${params.toString()}`;
}

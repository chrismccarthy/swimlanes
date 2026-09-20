// Subscribable calendar feed:
//
//   GET /functions/v1/ics?member=<uuid>&token=<uuid>
//   -> text/calendar with one all-day event per block of that member
//
// A calendar client (Google Calendar, Apple Calendar, Outlook) polls this URL
// with no session of any kind, so the token in the query string is the only
// credential. It is checked against `ics_tokens` (migration 008) with the
// service role key, which is also what lets this function read `members` and
// `blocks` past their RLS policies.
//
// Deploy with:  supabase functions deploy ics --no-verify-jwt
// (`--no-verify-jwt` because calendar clients cannot send an Authorization
// header; the token takes its place.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { generateIcs } from '../_shared/ics.ts';
import type { IcsEvent } from '../_shared/ics.ts';

interface TokenRow {
  member_id: string;
}

interface MemberRow {
  name: string;
}

interface BlockRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/** "yyyy-MM-dd", whether Postgres hands back a bare date or a timestamp. */
function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Calendar clients fetch server-side, but a browser might too, and the feed
  // is already public to whoever holds the token.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
      },
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return textResponse('Method not allowed', 405);
  }

  const url = new URL(req.url);
  const memberId = url.searchParams.get('member') ?? '';
  const token = url.searchParams.get('token') ?? '';

  // Shape-check before touching the database: an invalid uuid would otherwise
  // come back as a Postgres error rather than a clean 400.
  if (!UUID_RE.test(memberId) || !UUID_RE.test(token)) {
    return textResponse('Bad request', 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return textResponse('Server misconfigured', 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tokenResult = await supabase
    .from('ics_tokens')
    .select('member_id')
    .eq('token', token)
    .maybeSingle();

  if (tokenResult.error) return textResponse('Server error', 500);

  const tokenRow = tokenResult.data as TokenRow | null;
  // The same 404 for an unknown token and for a token belonging to someone
  // else: a feed URL should not confirm which of the two it is.
  if (!tokenRow || tokenRow.member_id !== memberId) {
    return textResponse('Not found', 404);
  }

  const [memberResult, blocksResult] = await Promise.all([
    supabase.from('members').select('name').eq('id', memberId).maybeSingle(),
    supabase
      .from('blocks')
      .select('id, title, start_date, end_date')
      .eq('member_id', memberId)
      .order('start_date'),
  ]);

  if (memberResult.error || blocksResult.error) return textResponse('Server error', 500);

  const member = memberResult.data as MemberRow | null;
  if (!member) return textResponse('Not found', 404);

  const events: IcsEvent[] = ((blocksResult.data ?? []) as BlockRow[]).map(block => ({
    uid: `${block.id}@swimlanes`,
    title: block.title,
    start: toIsoDate(block.start_date),
    end: toIsoDate(block.end_date),
  }));

  const body = generateIcs({
    calendarName: `Swimlanes — ${member.name}`,
    events,
  });

  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="swimlanes.ics"',
      'access-control-allow-origin': '*',
      // Calendar clients poll often; an hour of caching is plenty fresh for a
      // board whose blocks are whole days.
      'cache-control': 'public, max-age=3600',
    },
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/apiAuth';
import { fail, ok, rateLimited } from '@/lib/api/response';
import { checkRateLimit, getClientIp } from '@/lib/api/rateLimit';
import type { ProviderId } from '@/lib/settings/settings-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDGE_FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ai-chat`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const VALID_PROVIDERS: ProviderId[] = ['gemini', 'groq', 'nvidia', 'openrouter', 'ollama'];

interface ValidateBody {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Server-side proxy for Settings' "Validate Connection" button (Provider
 * Validation & Model Discovery pass, 2026-08-20). Authenticated like every
 * other mutating/sensitive route in this app (V1 Section 7 — RLS is not a
 * backstop server-side, see lib/auth/apiAuth.ts). The actual provider HTTP
 * logic lives in the ai-chat edge function's adapter registry (single
 * source of truth — this route does not duplicate it); this is purely the
 * authenticated entry point the browser calls, matching every other
 * data-touching route's pattern in app/api/**.
 *
 * Never logs, stores, or echoes back the apiKey — it passes through to the
 * edge function in the request body (same trust boundary already used by
 * saveSettings()) and the edge function's own response never includes it.
 */
export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const user = await requireUser(req);
    if (!user) {
      return NextResponse.json(fail('UNAUTHORIZED', 'Sign in required', start), { status: 401 });
    }

    // M1-03: this route calls a real provider through the ai-chat edge
    // function — rate-limited per user and per IP so it can't be used to
    // hammer a provider's API (or run up cost/quota) via repeated calls.
    const userLimit = await checkRateLimit(`validate-provider:user:${user.id}`, { maxTokens: 10, refillPerSec: 10 / 60 });
    if (!userLimit.allowed) {
      return NextResponse.json(rateLimited(start, userLimit.resetSeconds), { status: 429 });
    }
    const ipLimit = await checkRateLimit(`validate-provider:ip:${getClientIp(req)}`, { maxTokens: 20, refillPerSec: 20 / 60 });
    if (!ipLimit.allowed) {
      return NextResponse.json(rateLimited(start, ipLimit.resetSeconds), { status: 429 });
    }

    const body = await req.json().catch(() => null) as ValidateBody | null;
    if (!body || !body.provider || !VALID_PROVIDERS.includes(body.provider)) {
      return NextResponse.json(fail('BAD_REQUEST', 'A valid provider is required', start), { status: 400 });
    }

    const res = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        action: 'validate',
        provider: body.provider,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
      }),
    });

    const data = await res.json().catch(() => ({ status: 'unknown_error', message: 'Malformed response from validation service' }));
    return NextResponse.json(ok(data, start));
  } catch (err) {
    return NextResponse.json(
      fail('INTERNAL_ERROR', err instanceof Error ? err.message : 'Validation failed', start),
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { saveSubscription, clearSubscription } from '@/lib/pushStore';
import type { PushSubscription as WebPushSubscription } from 'web-push';

export const runtime = 'nodejs';

/** POST /api/push/subscribe — save (or replace) a push subscription.
 *  Body: { subscription: PushSubscription, threshold: number } | { unsubscribe: true }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.unsubscribe === true) {
      clearSubscription();
      return NextResponse.json({ ok: true, action: 'unsubscribed' });
    }

    const { subscription, threshold } = body as {
      subscription: WebPushSubscription;
      threshold:    number;
    };

    if (!subscription?.endpoint) {
      return NextResponse.json({ error: 'Missing subscription.endpoint' }, { status: 400 });
    }

    saveSubscription(subscription, threshold ?? 30);
    return NextResponse.json({ ok: true, action: 'subscribed', threshold });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[push/subscribe] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

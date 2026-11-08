import {
  MAX_BODY_BYTES,
  readWebhook,
  verifyWebhookSignature,
  type IngestParams,
} from '../_shared/razorpay.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export { readWebhook, type IngestParams };

export async function handleWebhook(
  req: Request,
  deps: { serviceClient: ReturnType<typeof createServiceClient>; webhookSecret: string },
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signature = req.headers.get('X-Razorpay-Signature') ?? '';
  const valid = await verifyWebhookSignature(rawBody, signature, deps.webhookSecret);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ ok: false, outcome: 'unprocessable', error: 'bad_json' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const eventId =
    req.headers.get('X-Razorpay-Event-Id') ??
    (isObj(parsed) && typeof parsed.event_id === 'string'
      ? parsed.event_id
      : isObj(parsed) && typeof parsed.id === 'string'
      ? parsed.id
      : null);

  const facts = readWebhook(eventId, parsed);
  if (!facts.ok) {
    if (facts.reason === 'not_handled') {
      return new Response(JSON.stringify({ status: 'ignored', reason: 'unhandled event type' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ status: 'ignored', reason: facts.reason }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: outcome, error } = await deps.serviceClient.rpc('billing_ingest_event', facts.params);
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'PT422') {
      return new Response(JSON.stringify({ status: 'rejected', reason: 'malformed_facts' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('billing_ingest_event error:', error);
    return new Response(JSON.stringify({ error: 'Ingest failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ status: 'ok', outcome: outcome ?? 'processed' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const serviceClient = createServiceClient();
    return handleWebhook(req, { serviceClient, webhookSecret });
  });
}

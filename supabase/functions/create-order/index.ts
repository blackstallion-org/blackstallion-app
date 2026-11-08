import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { AuthError, createServiceClient, createUserClient, getUserId } from '../_shared/supabase.ts';
import { createRazorpayClient, type RazorpayClient } from '../_shared/razorpay.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CheckoutSession {
  keyId: string;
  gatewayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  reference: string;
}

const PAYABLE_STATES = ['created', 'awaiting_payment', 'failed'];

export async function handleCreateOrder(
  req: Request,
  deps: { serviceClient: ReturnType<typeof createServiceClient>; razorpay: RazorpayClient; keyId: string },
): Promise<Response> {
  const json = (response: unknown, status = 200) =>
    new Response(JSON.stringify(response), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const userId = await getUserId(req, deps.serviceClient);

    const body = await req.json().catch(() => null);
    const orderId = body?.orderId;
    if (typeof orderId !== 'string' || !UUID.test(orderId)) {
      return json({ error: 'Invalid orderId' }, 400);
    }

    const userClient = createUserClient(req);
    const { data: order, error: orderErr } = await userClient.rpc('billing_get_order', { p_order: orderId });
    if (orderErr) {
      const code = (orderErr as { code?: string }).code;
      if (code === 'PT404' || code === '42501') return json({ error: 'Order not found' }, 404);
      return json({ error: 'Failed to read order' }, 500);
    }
    if (!order || typeof order !== 'object') return json({ error: 'Order not found' }, 404);

    const o = order as Record<string, unknown>;
    const state = o.state as string;
    const existingGateway = typeof o.gatewayOrderId === 'string' ? o.gatewayOrderId : null;
    const totalPaise = o.totalPaise as number;
    const reference = o.reference as string;

    if (!PAYABLE_STATES.includes(state)) {
      return json({ error: 'Order is not payable', state }, 409);
    }

    if (existingGateway) {
      const session: CheckoutSession = {
        keyId: deps.keyId,
        gatewayOrderId: existingGateway,
        amountPaise: totalPaise,
        currency: 'INR',
        reference,
      };
      return json(session);
    }

    const rzpOrder = await deps.razorpay.createOrder({
      amount: totalPaise,
      currency: 'INR',
      receipt: reference,
      notes: { billing_order_id: orderId, user_id: userId },
    });

    const { error: attachErr } = await deps.serviceClient.rpc('billing_attach_gateway_order', {
      p_order: orderId,
      p_gateway_order_id: rzpOrder.id,
    });
    if (attachErr) {
      return json({ error: 'Failed to attach gateway order' }, 500);
    }

    const session: CheckoutSession = {
      keyId: deps.keyId,
      gatewayOrderId: rzpOrder.id,
      amountPaise: totalPaise,
      currency: 'INR',
      reference,
    };
    return json(session);
  } catch (e) {
    if (e instanceof AuthError) return json({ error: 'Unauthorized' }, 401);
    if (e instanceof Error && e.message.startsWith('Razorpay API')) {
      return json({ error: 'Payment provider error' }, 502);
    }
    return json({ error: 'Internal error' }, 500);
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const keyId = Deno.env.get('RAZORPAY_KEY_ID');
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) {
    return new Response(JSON.stringify({ error: 'Payment provider not configured' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createServiceClient();
  const razorpay = createRazorpayClient(keyId, keySecret);
  return handleCreateOrder(req, { serviceClient, razorpay, keyId });
});

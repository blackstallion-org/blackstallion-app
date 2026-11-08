const encoder = new TextEncoder();

export async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret || !body) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = hexEncode(new Uint8Array(mac));
  return timingSafeEqual(expected, signature);
}

function hexEncode(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Razorpay API client (dependency-injectable for tests)
// ---------------------------------------------------------------------------

export interface RazorpayOrderParams {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayClient {
  createOrder(params: RazorpayOrderParams): Promise<RazorpayOrder>;
}

export function createRazorpayClient(keyId: string, keySecret: string): RazorpayClient {
  const credentials = btoa(`${keyId}:${keySecret}`);
  return {
    async createOrder(params: RazorpayOrderParams): Promise<RazorpayOrder> {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Razorpay API ${res.status}: ${text}`);
      }
      return (await res.json()) as RazorpayOrder;
    },
  };
}

export function createMockRazorpayClient(
  handler: (params: RazorpayOrderParams) => RazorpayOrder,
): RazorpayClient {
  return { createOrder: async (p) => handler(p) };
}

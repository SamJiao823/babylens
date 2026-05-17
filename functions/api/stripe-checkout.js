/**
 * BabyLens AI - Stripe Checkout (Cloudflare Pages Function)
 *
 * POST /api/stripe-checkout
 * Body: { plan, gender, momPhoto, dadPhoto }
 * Returns: { success, orderId, url }
 *
 * Requires env var: STRIPE_SECRET_KEY
 * Requires env var: STRIPE_PRICE_ID (default: price_1TY3daG78blCDeZMuEYA1fOi)
 */

const SITE_URL = 'https://babylens.pages.dev';

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `BL-${ts}-${rand}`;
}

export async function onRequest(context) {
  const { request, env } = context;

  // CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }

  try {
    const STRIPE_SECRET = env.STRIPE_SECRET_KEY;
    const PRICE_ID = env.STRIPE_PRICE_ID || 'price_1TY3daG78blCDeZMuEYA1fOi';

    if (!STRIPE_SECRET) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Stripe not configured. Please set STRIPE_SECRET_KEY in env.',
      }), {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { plan = 'basic', gender = 'both', momPhoto, dadPhoto } = body;

    if (!momPhoto || !dadPhoto) {
      return new Response(JSON.stringify({ success: false, message: 'Missing photos' }), {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    const orderId = generateOrderId();

    // 1. Save order to D1 database
    if (env && env.DB) {
      await env.DB.prepare(
        `INSERT INTO orders (id, plan, gender, status, mom_photo, dad_photo, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, datetime('now'))`
      ).bind(orderId, plan, gender, momPhoto, dadPhoto).run();
    }

    // 2. Create Stripe Checkout Session via REST API
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'payment',
        'line_items[0][price]': PRICE_ID,
        'line_items[0][quantity]': '1',
        'metadata[orderId]': orderId,
        'metadata[plan]': plan,
        'metadata[gender]': gender,
        'success_url': `${SITE_URL}/?status=success&order=${orderId}`,
        'cancel_url': `${SITE_URL}/`,
        'customer_creation': 'if_required',
      }).toString(),
    });

    const session = await stripeRes.json();

    if (!session.url) {
      console.error('[stripe-checkout] Stripe error:', JSON.stringify(session));
      throw new Error(session.error?.message || 'Failed to create checkout session');
    }

    return new Response(JSON.stringify({
      success: true,
      orderId,
      url: session.url,
      sessionId: session.id,
    }), {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[stripe-checkout] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      message: err.message || 'Internal error',
    }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }
}

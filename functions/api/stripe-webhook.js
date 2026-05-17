/**
 * BabyLens AI - Stripe Webhook Handler
 *
 * POST /api/stripe-webhook
 * Called by Stripe when payment succeeds
 *
 * Requires env var: STRIPE_SECRET_KEY (used for webhook signature verification if needed)
 */

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
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await request.text();
    const event = JSON.parse(body);

    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;

      if (orderId && env && env.DB) {
        // Mark order as paid, grant 3 credits
        await env.DB.prepare(
          `UPDATE orders
           SET status = 'paid',
               paid_at = datetime('now'),
               credits_remaining = 3,
               stripe_session_id = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(session.id, orderId).run();

        console.log(`[stripe-webhook] ✅ Order ${orderId} paid, 3 credits granted`);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[stripe-webhook] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

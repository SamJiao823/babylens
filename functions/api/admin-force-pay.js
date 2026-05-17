/**
 * BabyLens AI - Admin Force Pay (for Sandbox/QuickTest only)
 *
 * POST /api/admin-force-pay → Mark order as paid (requires admin password)
 *
 * 注意：这个端点仅供管理后台测试用，需要管理员密码验证。
 * 真实用户付款必须走 PayPal IPN 回调。
 */

const ADMIN_PASSWORD = 'babylens2024';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = await request.json();
    const { orderId, password } = body;

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (password !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const order = await env.DB.prepare(
      `SELECT * FROM orders WHERE id = ?`
    ).bind(orderId).first();

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    if (order.status === 'paid') {
      return new Response(
        JSON.stringify({ success: true, message: 'Already paid', orderId: order.id }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, credits_remaining = 3 WHERE id = ?`
    ).bind(now, orderId).run();

    console.log(`[admin-force-pay] ✅ Order ${orderId} marked as paid (admin, credits: 3)`);

    return new Response(
      JSON.stringify({ success: true, message: 'Payment forced (admin)', orderId, paidAt: now }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[admin-force-pay] Error:', err.message);
    return new Response(
      JSON.stringify({ error: 'Failed', message: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

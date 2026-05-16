/**
 * BabyLens AI - Payment Verification API
 *
 * POST /api/verify → Verify payment and mark order as paid
 *
 * 验证策略：
 * 1. 前端在付款跳回后调用此 API
 * 2. 服务器验证订单存在且为 pending 状态
 * 3. 将状态标记为 paid，允许后续生成照片
 * 4. 后续可升级为 PayPal PDT/IPN 验证
 */

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
    const { orderId } = body;

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // 查找订单
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
      // 已经付过款了，幂等返回
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Already paid',
          orderId: order.id,
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (order.status !== 'pending') {
      return new Response(JSON.stringify({ error: `Order status is ${order.status}, cannot verify` }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // 标记为已付款
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?`
    ).bind(now, orderId).run();

    console.log(`[verify] ✅ Order ${orderId} marked as paid`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Payment verified',
        orderId,
        paidAt: now,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('[verify] Error:', err.message);
    return new Response(
      JSON.stringify({ error: 'Verification failed', message: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

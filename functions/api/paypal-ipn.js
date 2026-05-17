/**
 * BabyLens AI - PayPal IPN (Instant Payment Notification) Endpoint
 *
 * POST /api/paypal-ipn → Receive payment confirmation from PayPal
 *
 * 流程：
 * 1. PayPal 发 POST 到本端点（带付款信息）
 * 2. 本端点把原始数据原样发回 PayPal 验证（cmd=_notify-validate）
 * 3. PayPal 回复 VERIFIED → 标记订单为已付款
 * 4. PayPal 回复 INVALID → 拒绝（可能是伪造）
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/x-www-form-urlencoded',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // ─── 1. 读取 PayPal 发来的原始表单数据 ──────────────────────────
    const rawBody = await request.text();
    const params = new URLSearchParams(rawBody);
    const bodyObj = Object.fromEntries(params.entries());

    console.log('[paypal-ipn] Received IPN:', JSON.stringify(bodyObj, null, 2));

    // ─── 2. 发回 PayPal 验证 ───────────────────────────────────────
    const verificationBody = `cmd=_notify-validate&${rawBody}`;

    const verificationRes = await fetch('https://ipnpb.paypal.com/cgi-bin/webscr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verificationBody,
    });

    const verificationResult = await verificationRes.text();
    console.log('[paypal-ipn] PayPal verification result:', verificationResult);

    if (verificationResult !== 'VERIFIED') {
      console.warn('[paypal-ipn] ❌ INVALID IPN from PayPal', verificationResult);
      return new Response('INVALID', { status: 200 }); // 200 让 PayPal 不重试
    }

    // ─── 3. PayPal 验证通过 ✅ 开始处理 ────────────────────────────
    console.log('[paypal-ipn] ✅ IPN VERIFIED');

    // ─── 3a. 只处理已完成的付款 ────────────────────────────────────
    const paymentStatus = bodyObj.payment_status;
    if (paymentStatus !== 'Completed') {
      console.log(`[paypal-ipn] Payment status is "${paymentStatus}", skipping`);
      return new Response('OK', { status: 200 });
    }

    // ─── 3b. 验证收款账号 ──────────────────────────────────────────
    const receiverEmail = bodyObj.receiver_email;
    if (receiverEmail !== '4886458@qq.com') {
      console.warn(`[paypal-ipn] Wrong receiver: ${receiverEmail}`);
      return new Response('OK', { status: 200 });
    }

    // ─── 3c. 验证金额 ──────────────────────────────────────────────
    const gross = parseFloat(bodyObj.mc_gross || '0');
    const currency = bodyObj.mc_currency;
    if (gross < 9.99 || currency !== 'USD') {
      console.warn(`[paypal-ipn] Amount mismatch: ${gross} ${currency}`);
      return new Response('OK', { status: 200 });
    }

    // ─── 3d. 从 custom 字段解析 orderId ────────────────────────────
    // custom 格式: "BL-XXXXX:uuid"
    const custom = bodyObj.custom || '';
    const orderId = custom.split(':')[0];
    if (!orderId || !orderId.startsWith('BL-')) {
      console.warn(`[paypal-ipn] Invalid custom field: ${custom}`);
      return new Response('OK', { status: 200 });
    }

    // ─── 3e. 检查 txn_id 是否已经处理过（幂等） ────────────────────
    const txnId = bodyObj.txn_id || '';
    if (txnId) {
      const existing = await env.DB.prepare(
        `SELECT id FROM orders WHERE paypal_transaction_id = ?`
      ).bind(txnId).first();
      if (existing) {
        console.log(`[paypal-ipn] ⏭️ Txn ${txnId} already processed, skipping`);
        return new Response('OK', { status: 200 });
      }
    }

    // ─── 4. 标记订单为已付款！ ─────────────────────────────────────
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = ?, paypal_transaction_id = ?, credits_remaining = 3 WHERE id = ? AND status = 'pending'`
    ).bind(now, txnId, orderId).run();

    console.log(`[paypal-ipn] ✅ Order ${orderId} marked as paid (txn: ${txnId}, credits: 3)`);

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[paypal-ipn] Error:', err.message);
    // 返回 200 不让 PayPal 重试
    return new Response('OK', { status: 200 });
  }
}

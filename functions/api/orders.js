/**
 * BabyLens AI - Order Management API
 *
 * POST /api/orders             → Create a new payment order
 * GET  /api/orders             → List all orders (admin)
 * GET  /api/orders/check       → Poll order status (frontend)
 * GET  /api/orders/photos      → Get order photos (admin)
 * POST /api/orders/save-result → Save generation results
 */

const ADMIN_PASSWORD = 'babylens2024';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function generateOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `BL-${ts}-${rand}`;
}

// ─── Router ────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  if (method === 'POST' && (path === '/api/orders' || path === '/api/orders/')) {
    return handleCreateOrder(request, env);
  }

  if (method === 'GET' && (path === '/api/orders' || path === '/api/orders/')) {
    return handleListOrders(request, env, url);
  }

  if (method === 'GET' && path.endsWith('/check')) {
    return handleCheckOrder(request, env, url);
  }

  if (method === 'GET' && path.endsWith('/photos')) {
    return handleGetPhotos(request, env, url);
  }

  if (method === 'POST' && path.endsWith('/save-result')) {
    return handleSaveResult(request, env);
  }

  if (method === 'POST' && path.endsWith('/delete-data')) {
    return handleDeleteData(request, env);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: CORS_HEADERS,
  });
}

// ─── POST /api/orders — 创建订单 ──────────────────────────────────────────
async function handleCreateOrder(request, env) {
  try {
    const body = await request.json();
    const { plan = 'basic', gender = 'both', momPhoto, dadPhoto } = body;

    if (!momPhoto || !dadPhoto) {
      return new Response(JSON.stringify({ error: 'Missing parent photos' }), {
        status: 400, headers: CORS_HEADERS,
      });
    }

    const orderId = generateOrderId();
    const verificationToken = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO orders (id, plan, gender, amount, status, mom_photo, dad_photo, created_at)
       VALUES (?, ?, ?, 9.99, 'pending', ?, ?, ?)`
    ).bind(orderId, plan, gender, momPhoto, dadPhoto, now).run();

    const paypalUrl =
      `https://www.paypal.com/cgi-bin/webscr?` +
      `cmd=_xclick` +
      `&business=4886458%40qq.com` +
      `&item_name=BabyLens+AI+Basic` +
      `&amount=9.99` +
      `&currency_code=USD` +
      `&return=${encodeURIComponent('https://babylens.pages.dev?status=success&order=' + orderId)}` +
      `&cancel_return=${encodeURIComponent('https://babylens.pages.dev')}` +
      `&notify_url=${encodeURIComponent('https://babylens.pages.dev/api/paypal-ipn')}` +
      `&custom=${orderId}:${verificationToken}` +
      `&no_note=1` +
      `&no_shipping=1` +
      `&lc=US` +
      `&bn=PP-BuyNowBF%3Abtn_buynowCC_LG` +
      `&useraction=commit` +
      `&solution_type=Sole` +
      `&landing_page=billing`;

    return new Response(JSON.stringify({ success: true, orderId, verificationToken, paypalUrl }), {
      status: 200, headers: CORS_HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to create order', message: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

// ─── GET /api/orders — 管理员查看 ──────────────────────────────────────────
async function handleListOrders(request, env, url) {
  const pw = request.headers.get('X-Admin-Password') || url.searchParams.get('password');
  if (pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: CORS_HEADERS,
    });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`
    ).all();
    return new Response(JSON.stringify({ success: true, orders: results }), {
      status: 200, headers: CORS_HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

// ─── GET /api/orders/check?orderId=XXX ─────────────────────────────────────
async function handleCheckOrder(request, env, url) {
  const orderId = url.searchParams.get('orderId');
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Missing orderId' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  try {
    const order = await env.DB.prepare(
      `SELECT id, status, result_mom, result_dad, paid_at FROM orders WHERE id = ?`
    ).bind(orderId).first();

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404, headers: CORS_HEADERS,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        resultMom: order.result_mom,
        resultDad: order.result_dad,
        paidAt: order.paid_at,
      },
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

// ─── GET /api/orders/photos?orderId=XXX&password=XXX ──────────────────────
async function handleGetPhotos(request, env, url) {
  const pw = url.searchParams.get('password');
  if (pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: CORS_HEADERS,
    });
  }

  const orderId = url.searchParams.get('orderId');
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Missing orderId' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  try {
    const order = await env.DB.prepare(
      `SELECT id, mom_photo, dad_photo, result_mom, result_dad FROM orders WHERE id = ?`
    ).bind(orderId).first();

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404, headers: CORS_HEADERS,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      order: {
        id: order.id,
        momPhoto: order.mom_photo,
        dadPhoto: order.dad_photo,
        resultMom: order.result_mom,
        resultDad: order.result_dad,
      },
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

// ─── POST /api/orders/save-result ──────────────────────────────────────────
async function handleSaveResult(request, env) {
  try {
    const body = await request.json();
    const { orderId, resultMom, resultDad } = body;

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400, headers: CORS_HEADERS,
      });
    }

    const now = new Date().toISOString();
    const updateFields = ['status = ?', 'delivered_at = ?'];
    const values = ['delivered', now];

    if (resultMom) {
      updateFields.push('result_mom = ?');
      values.push(resultMom);
    }
    if (resultDad) {
      updateFields.push('result_dad = ?');
      values.push(resultDad);
    }

    values.push(orderId);

    await env.DB.prepare(
      `UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    return new Response(JSON.stringify({ success: true, message: 'Results saved' }), {
      status: 200, headers: CORS_HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}
// ─── POST /api/orders/delete-data — 一键删除用户照片数据 ─────────────────
async function handleDeleteData(request, env) {
  try {
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400, headers: CORS_HEADERS,
      });
    }

    const order = await env.DB.prepare(
      `SELECT id FROM orders WHERE id = ?`
    ).bind(orderId).first();

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404, headers: CORS_HEADERS,
      });
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE orders SET mom_photo = NULL, dad_photo = NULL, result_mom = NULL, result_dad = NULL, data_deleted_at = ? WHERE id = ?`
    ).bind(now, orderId).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'All your photos have been permanently deleted from our servers.',
      deletedAt: now,
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

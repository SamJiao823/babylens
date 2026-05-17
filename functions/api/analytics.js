/**
 * BabyLens AI - Analytics API
 *
 * POST /api/analytics → Record a page view (body: { date, unique })
 * GET  /api/analytics → Get visit statistics (query: password=xxx)
 */

const ADMIN_PASSWORD = 'babylens2024';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  if (method === 'POST') {
    return handlePageView(request, env);
  }

  if (method === 'GET') {
    return handleStats(env, url);
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: CORS_HEADERS,
  });
}

async function handlePageView(request, env) {
  try {
    const body = await request.json();
    const today = body.date || new Date().toISOString().split('T')[0];
    const isUnique = body.unique === true;

    const existing = await env.DB.prepare(
      `SELECT id, count, unique_visitors FROM page_views WHERE date = ?`
    ).bind(today).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE page_views SET count = count + 1, unique_visitors = unique_visitors + ?, updated_at = datetime('now') WHERE date = ?`
      ).bind(isUnique ? 1 : 0, today).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO page_views (date, count, unique_visitors) VALUES (?, 1, ?)`
      ).bind(today, isUnique ? 1 : 0).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: CORS_HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

async function handleStats(env, url) {
  const pw = url.searchParams.get('password');
  if (pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: CORS_HEADERS,
    });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const todayRow = await env.DB.prepare(
      `SELECT count, unique_visitors FROM page_views WHERE date = ?`
    ).bind(today).first();

    const yesterdayRow = await env.DB.prepare(
      `SELECT count, unique_visitors FROM page_views WHERE date = ?`
    ).bind(yesterday).first();

    const { results: weekTrend } = await env.DB.prepare(
      `SELECT date, count, unique_visitors FROM page_views WHERE date >= ? ORDER BY date ASC`
    ).bind(new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]).all();

    const totals = await env.DB.prepare(
      `SELECT SUM(count) as total_views, SUM(unique_visitors) as total_unique FROM page_views`
    ).first();

    return new Response(JSON.stringify({
      success: true,
      today: {
        date: today,
        views: todayRow?.count || 0,
        unique: todayRow?.unique_visitors || 0,
      },
      yesterday: {
        date: yesterday,
        views: yesterdayRow?.count || 0,
        unique: yesterdayRow?.unique_visitors || 0,
      },
      weekTrend: weekTrend || [],
      totals: {
        totalViews: totals?.total_views || 0,
        totalUnique: totals?.total_unique || 0,
      },
    }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: CORS_HEADERS,
    });
  }
}

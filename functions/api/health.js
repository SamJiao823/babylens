/**
 * Health Check API
 *
 * GET /api/health → { status, site, timestamp }
 * 用于 Uptime Robot / Better Uptime 等监控服务定期检查网站可用性
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS, status: 204 });
  }

  const health = {
    status: 'ok',
    site: url.origin,
    timestamp: new Date().toISOString(),
    uptime: true,
    version: '1.0.0',
  };

  return new Response(JSON.stringify(health, null, 2), {
    headers: CORS_HEADERS,
    status: 200,
  });
}
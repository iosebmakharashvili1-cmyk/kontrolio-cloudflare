/* functions/api/rum.js — POST /api/rum
   Real User Monitoring endpoint. Accepts Core Web Vitals data via
   navigator.sendBeacon and logs it for analysis. */
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.text();
    const data = JSON.parse(body);

    // Basic validation
    if (!data || typeof data !== 'object') {
      return new Response('invalid', { status: 400 });
    }

    // Strip sensitive fields
    const safe = {
      url: String(data.url || '').slice(0, 200),
      ts: Number(data.ts) || 0,
      lcp: Number(data.lcp) || 0,
      cls: Number(data.cls) || 0,
      fid: Number(data.fid) || 0,
      ttfb: Number(data.ttfb) || 0,
      loadTime: Number(data.loadTime) || 0,
      dpr: Number(data.dpr) || 1,
      fidTarget: String(data.fidTarget || '').slice(0, 50),
      userAgent: request.headers.get('user-agent')?.slice(0, 200) || '',
      country: request.headers.get('cf-ipcountry') || '',
    };

    // Log to console (Cloudflare Workers Analytics will pick this up)
    console.log('RUM:', JSON.stringify(safe));

    // Optionally store in KV for aggregated dashboards
    if (env && env.KV) {
      const key = `rum:${new Date().toISOString().slice(0, 13)}:${crypto.randomUUID().slice(0, 8)}`;
      await env.KV.put(key, JSON.stringify(safe), { expirationTtl: 86400 * 7 });
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response('error: ' + e.message, { status: 500 });
  }
}

/* Also accept OPTIONS for CORS */
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/* ============================================================
   functions/api/_middleware.js
   ------------------------------------------------------------
   სერვის-დღის ლოგიკა + rate limiting (KV-ით) + CORS headers.
   კოდი იდენტურია server.js-ის — cutoff ახლა 00:00-ზეა.
   ============================================================ */

/* ---------- სერვის-დღის ლოგიკა ---------- */
export function tbilisiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tbilisi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return {
    year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour") % 24, minute: get("minute"), second: get("second"),
  };
}

function pad2(n) { return String(n).padStart(2, "0"); }

export function serviceDayKey(date = new Date()) {
  const p = tbilisiParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/* ---------- Rate limiting (POST /api/reports) ----------
   key = "rl:<ip>:<day>", max 12 / 5 წუთი, TTL = 300 წმ */
const RL_MAX = 12;
const RL_TTL = 300;

export async function checkRateLimit(env, ip) {
  if (!env.KV) return { ok: true };
  const day = serviceDayKey();
  const key = `rl:${ip}:${day}`;
  const raw = await env.KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RL_MAX) return { ok: false };
  await env.KV.put(key, String(count + 1), { expirationTtl: RL_TTL });
  return { ok: true };
}

/* ---------- Middleware ---------- */
export async function onRequest({ request, env, next }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const response = await next();
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

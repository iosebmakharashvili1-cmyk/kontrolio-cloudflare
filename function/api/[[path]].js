// site/functions/api/[[path]].js

import STOP_NAMES from "./stopNames.json";

const VALID_STATUSES = new Set(["inspector", "clear"]);
const MAX_ACTIVITY_ENTRIES = 500;
const CUTOFF_HOUR = 23;
const CUTOFF_MINUTE = 30;
const HEARTBEAT_TTL_SEC = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function tbilisiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tbilisi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}
const pad2 = (n) => String(n).padStart(2, "0");

function serviceDayKey(date = new Date()) {
  const p = tbilisiParts(date);
  const afterCutoff = p.hour > CUTOFF_HOUR || (p.hour === CUTOFF_HOUR && p.minute >= CUTOFF_MINUTE);
  if (!afterCutoff) return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

async function loadStore(kv) {
  const raw = await kv.get("store", "json");
  return raw || { reports: {}, activity: [] };
}
async function saveStore(kv, store) {
  await kv.put("store", JSON.stringify(store));
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  const kv = env.KONTROLIO_KV;

  if (method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!kv) return json({ error: "KV ar aris dakavshirebuli (KONTROLIO_KV binding)" }, 500);

  // მოდიფიცირებული როუტინგი: ვამოწმებთ ენდპოინტს endsWith-ით, რათა თავიდან ავიცილოთ /api-ს დუბლირება
  const path = url.pathname.replace(/\/$/, ""); // ვაშორებთ ბოლო სლეშს ასეთის არსებობის შემთხვევაში

  // GET /reports
  if (path.endsWith("/reports") && method === "GET") {
    const store = await loadStore(kv);
    const current = serviceDayKey();
    const out = {};
    for (const [stopId, rec] of Object.entries(store.reports)) {
      if (rec.reportDate === current) out[stopId] = { status: rec.status, ts: rec.ts };
    }
    return json(out);
  }

  // POST /reports
  if (path.endsWith("/reports") && method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
    const { stopId, status } = body || {};

    if (typeof stopId !== "string" || !stopId.trim()) return json({ error: "stopId is required" }, 400);
    if (!VALID_STATUSES.has(status)) return json({ error: 'status must be "inspector" or "clear"' }, 400);
    if (Object.keys(STOP_NAMES).length > 0 && !Object.prototype.hasOwnProperty.call(STOP_NAMES, stopId)) {
      return json({ error: "unknown stopId" }, 400);
    }

    const store = await loadStore(kv);
    const ts = Date.now();
    const reportDate = serviceDayKey();
    const safeName = STOP_NAMES[stopId] || "გაჩერება";

    store.reports[stopId] = { status, ts, reportDate };
    store.activity.push({ stopName: safeName, status, ts, reportDate });
    if (store.activity.length > MAX_ACTIVITY_ENTRIES) {
      store.activity = store.activity.slice(-MAX_ACTIVITY_ENTRIES);
    }
    for (const id of Object.keys(store.reports)) {
      if (store.reports[id].reportDate !== reportDate) delete store.reports[id];
    }
    store.activity = store.activity.filter((a) => a.reportDate === reportDate);

    await saveStore(kv, store);
    return json({ stopId, status, ts });
  }

  // GET /activity
  if (path.endsWith("/activity") && method === "GET") {
    const store = await loadStore(kv);
    const current = serviceDayKey();
    const todays = store.activity.filter((a) => a.reportDate === current);
    const recent = todays.slice(-100).reverse();
    return json(recent.map((a) => ({ stopName: a.stopName, status: a.status, ts: a.ts })));
  }

  // GET /health
  if (path.endsWith("/health") && method === "GET") {
    return json({ ok: true, time: new Date().toISOString() });
  }

  // GET /arrivals
  if (path.endsWith("/arrivals") && method === "GET") {
    const idsParam = url.searchParams.get("ids");
    if (!idsParam || !idsParam.trim()) return json({ error: "ids query param is required" }, 400);
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
    if (ids.length === 0) return json({ error: "no valid ids" }, 400);

    const TTC_BASE = "https://transit.ttc.com.ge/pis-gateway/api/v2/stops";
    const TTC_HEADERS = {
      Accept: "application/json",
      Referer: "https://transit.ttc.com.ge/",
      Origin: "https://transit.ttc.com.ge",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };
    if (env.TTC_COOKIE) TTC_HEADERS["Cookie"] = env.TTC_COOKIE;
    if (env.TTC_API_KEY) TTC_HEADERS["X-api-key"] = env.TTC_API_KEY;

    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`${TTC_BASE}/${encodeURIComponent(id)}/arrival-times?locale=ka&ignoreScheduledArrivalTimes=false`, { headers: TTC_HEADERS })
          .then(async (r) => { if (!r.ok) throw new Error(`upstream ${r.status} for ${id}`); return r.json(); })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const errors = results.filter((r) => r.status === "rejected").map((r) => String(r.reason));
    if (ok.length === 0) return json({ error: "ttc upstream failed", details: errors }, 502);
    return json({ stops: ok });
  }

  // GET /heartbeat
  if (path.endsWith("/heartbeat") && method === "GET") {
    const sid = (url.searchParams.get("sid") || "").slice(0, 64);
    if (!sid) return json({ error: "sid required" }, 400);
    await kv.put(`online:${sid}`, "1", { expirationTtl: HEARTBEAT_TTL_SEC });
    const list = await kv.list({ prefix: "online:" });
    return json({ online: list.keys.length });
  }

  // GET /online
  if (path.endsWith("/online") && method === "GET") {
    const list = await kv.list({ prefix: "online:" });
    return json({ online: list.keys.length });
  }

  return json({ error: "Route not found", debugPath: url.pathname }, 404);
}

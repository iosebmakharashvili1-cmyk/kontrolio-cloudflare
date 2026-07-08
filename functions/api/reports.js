/* ============================================================
   functions/api/reports.js
   ------------------------------------------------------------
   GET  /api/reports?sid=<sid>
     → { stopId: {status, ts, confirmCount, viewerCount, reportsToday} }

   POST /api/reports
     body: { stopId, status, sid }
     → { stopId, status, ts, confirmCount, reportsToday, scored }

   KV keys:
     report:<day>:<stopId>      → JSON: {status, ts, confirmations:{sid:ts,...}}
     activity:<day>             → JSON: [{stopName,status,ts}, ...] (max 100)
     dailycount:<day>:<stopId>  → string (number)
     viewers:<stopId>           → JSON: {sid: ts, ...}  (TTL 26h, in-request only)
     score:<sid>                → string (number) — მუდმივი, არ იშლება დღიურად
   ============================================================ */

import { serviceDayKey, checkRateLimit } from "./_middleware.js";
import { STOP_NAMES } from "./_stopNames.js";
import { awardFirstReportPoint } from "./_leaderboard.js";

const VALID_STATUSES = new Set(["inspector", "clear"]);
const CONFIRM_WINDOW_MS = 90 * 60 * 1000; // 90 წუთი

function confirmCount(confirmations) {
  if (!confirmations) return 1;
  const cutoff = Date.now() - CONFIRM_WINDOW_MS;
  return Math.max(1, Object.values(confirmations).filter((ts) => ts > cutoff).length);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const safeSid = sid ? sid.slice(0, 64) : null;
  const day = serviceDayKey();

  const listed = await env.KV.list({ prefix: `report:${day}:` });

  const out = {};
  await Promise.all(
    listed.keys.map(async ({ name }) => {
      const stopId = name.slice(`report:${day}:`.length);
      const raw = await env.KV.get(name);
      if (!raw) return;
      const rec = JSON.parse(raw);

      // viewer tracking — ვინც ამ გაჩერებას ხედავს, მის "viewers" სიაში ჩაიწერება
      let viewerCnt = 0;
      if (safeSid) {
        const vKey = `viewers:${stopId}`;
        const vRaw = await env.KV.get(vKey);
        const viewers = vRaw ? JSON.parse(vRaw) : {};
        viewers[safeSid] = Date.now();
        // ვასუფთავებთ 30 წუთზე ძველ viewer-ებს
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [s, t] of Object.entries(viewers)) {
          if (t < cutoff) delete viewers[s];
        }
        await env.KV.put(vKey, JSON.stringify(viewers), { expirationTtl: 26 * 3600 });
        viewerCnt = Object.keys(viewers).length;
      }

      const dailyRaw = await env.KV.get(`dailycount:${day}:${stopId}`);
      const reportsToday = dailyRaw ? parseInt(dailyRaw, 10) : 0;

      out[stopId] = {
        status: rec.status,
        ts: rec.ts,
        confirmCount: confirmCount(rec.confirmations),
        viewerCount: viewerCnt,
        reportsToday,
      };
    })
  );

  return Response.json(out);
}

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") ||
             request.headers.get("X-Forwarded-For") || "unknown";

  const rl = await checkRateLimit(env, ip);
  if (!rl.ok) {
    return Response.json(
      { error: "ძალიან ხშირი შეტყობინებები — სცადე რამდენიმე წუთში" },
      { status: 429 }
    );
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const { stopId, status, sid } = body || {};
  if (typeof stopId !== "string" || !stopId.trim())
    return Response.json({ error: "stopId is required" }, { status: 400 });
  if (!VALID_STATUSES.has(status))
    return Response.json({ error: 'status must be "inspector" or "clear"' }, { status: 400 });
  if (Object.keys(STOP_NAMES).length > 0 && !Object.prototype.hasOwnProperty.call(STOP_NAMES, stopId))
    return Response.json({ error: "unknown stopId" }, { status: 400 });

  const safeSid = typeof sid === "string" ? sid.slice(0, 64) : null;
  const ts = Date.now();
  const day = serviceDayKey();
  const safeName = STOP_NAMES[stopId] || "გაჩერება";

  const reportKey = `report:${day}:${stopId}`;
  const existingRaw = await env.KV.get(reportKey);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  const statusChanged = !existing || existing.status !== status;

  /* "პირველობის" ქულა — მხოლოდ მაშინ, როცა ეს კონკრეტული report
     აქცევს გაჩერებას "თავისუფლიდან/უცნობიდან" → "კონტროლიორზე".
     განმეორებითი დადასტურება (statusChanged === false) ან
     "თავისუფალია"-ს მონიშვნა ქულას არ იძლევა. */
  let scored = false;
  if (statusChanged && status === "inspector" && safeSid) {
    scored = await awardFirstReportPoint(env, safeSid);
  }

  let confirmations = statusChanged ? {} : { ...(existing.confirmations || {}) };
  if (safeSid) confirmations[safeSid] = ts;

  // თუ სტატუსი შეიცვალა — viewers გავასუფთავოთ
  if (statusChanged) {
    await env.KV.delete(`viewers:${stopId}`);
  }

  await env.KV.put(reportKey, JSON.stringify({ status, ts, confirmations }), {
    expirationTtl: 27 * 3600,
  });

  // daily count
  const dcKey = `dailycount:${day}:${stopId}`;
  const dcRaw = await env.KV.get(dcKey);
  const newCount = (dcRaw ? parseInt(dcRaw, 10) : 0) + 1;
  await env.KV.put(dcKey, String(newCount), { expirationTtl: 27 * 3600 });

  // activity
  const actKey = `activity:${day}`;
  const actRaw = await env.KV.get(actKey);
  const list = actRaw ? JSON.parse(actRaw) : [];
  list.push({ stopName: safeName, status, ts });
  if (list.length > 100) list.splice(0, list.length - 100);
  await env.KV.put(actKey, JSON.stringify(list), { expirationTtl: 27 * 3600 });

  return Response.json({
    stopId, status, ts,
    confirmCount: confirmCount(confirmations),
    reportsToday: newCount,
    scored,
  });
}

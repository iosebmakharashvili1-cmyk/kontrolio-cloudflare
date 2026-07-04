/* functions/api/arrivals.js — GET /api/arrivals?ids=<id1>,<id2> */
import { STOP_NAMES } from "./_stopNames.js";

const TTC_BASE = "https://transit.ttc.com.ge/pis-gateway/api/v2/stops";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam?.trim()) return Response.json({ error: "ids required" }, { status: 400 });

  let ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (Object.keys(STOP_NAMES).length > 0) {
    ids = ids.filter((id) => Object.prototype.hasOwnProperty.call(STOP_NAMES, id));
  }
  if (!ids.length) return Response.json({ error: "no valid ids" }, { status: 400 });

  const headers = {
    Accept: "application/json",
    Referer: "https://transit.ttc.com.ge/",
    Origin: "https://transit.ttc.com.ge",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  if (env.TTC_COOKIE) headers["Cookie"] = env.TTC_COOKIE;
  if (env.TTC_API_KEY) headers["X-api-key"] = env.TTC_API_KEY;

  const results = await Promise.allSettled(
    ids.map((id) =>
      fetch(
        `${TTC_BASE}/${encodeURIComponent(id)}/arrival-times?locale=ka&ignoreScheduledArrivalTimes=false`,
        { headers }
      ).then(async (r) => {
        if (!r.ok) throw new Error(`upstream ${r.status} for ${id}`);
        return r.json();
      })
    )
  );

  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) return Response.json({ error: "ttc upstream failed" }, { status: 502 });
  return Response.json({ stops: ok });
}

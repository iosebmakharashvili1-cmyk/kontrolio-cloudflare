/*============================================================
   functions/api/arrivals.js — GET /api/arrivals?ids=<id1>,<id2>
   ------------------------------------------------------------
   ორ ქალაქს ემსახურება — Tbilisi (TTC) და Rustavi (AzRy Cloud),
   stop-id-ის პრეფიქსის მიხედვით:
     "1:204"           -> თბილისის TTC endpoint
     "rustavi-1:204"   -> რუსთავის endpoint (პრეფიქსი მოცილებულია
                          ნამდვილ API-request-ში გაგზავნამდე)

   ⚠️ Rustavi endpoint-ი production-ში Cookie header-საც იყენებდა
   (mobile app-ის capture-ით დადასტურებული), მაგრამ ჩვენ მისი
   ზუსტი მნიშვნელობა არ გვაქვს — ვცდით მხოლოდ X-api-key-ით.
   თუ ეს არასაკმარისი აღმოჩნდა, upstream 401/403-ს დააბრუნებს და
   ეს ცალკე ჩანს request-ის შედეგში (log-ში) — მაშინ საჭირო
   იქნება namdvili Cookie-ის მოპოვება და env.RUSTAVI_COOKIE-ში
   დამატება (იხ. wrangler.toml-ის კომენტარი).
   ============================================================ */

import { STOP_NAMES } from "./_stopNames.js";
// STOP_NAMES უკვე შეიცავს ორივე ქალაქის stop-ებს ერთ ობიექტში —
// რუსთავის ID-ები "rustavi-" პრეფიქსით (იხ. _stopNames.js-ის თავზე
// კომენტარი). ცალკე _rustaviStopNames.js საჭირო აღარაა.
//
// ⚠️ STOP_NAMES-ის ზოგიერთი key გაერთიანებულია "+"-ით (მაგ.
// "1:4366+1:4367") — ეს ორი ფიზიკური ავტობუსის სვეტი, რომლებიც
// stops.js-ში ერთ ლოგიკურ გაჩერებადაა წარმოდგენილი (stop.ids
// მასივით). frontend-ი კი /api/arrivals-ს თითოეულ ID-ს ცალ-ცალკე
// უგზავნის ("1:4366", "1:4367"), ამიტომ ვალიდაციამ ცალკეული
// sub-ID-ებიც უნდა ცნოს — არა მხოლოდ ზუსტი გაერთიანებული key.
const VALID_STOP_IDS = new Set();
for (const key of Object.keys(STOP_NAMES)) {
  key.split("+").forEach((sub) => VALID_STOP_IDS.add(sub));
}

const TBILISI_BASE = "https://transit.ttc.com.ge/pis-gateway/api/v2/stops";
const RUSTAVI_BASE = "https://rustavi-transit.azrycloud.com/pis-gateway/api/v2/stops";
const RUSTAVI_PREFIX = "rustavi-";

function baseHeaders(env) {
  const headers = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  if (env.TTC_API_KEY) headers["X-api-key"] = env.TTC_API_KEY;
  return headers;
}

function tbilisiHeaders(env) {
  const headers = {
    ...baseHeaders(env),
    Referer: "https://transit.ttc.com.ge/",
    Origin: "https://transit.ttc.com.ge",
  };
  if (env.TTC_COOKIE) headers["Cookie"] = env.TTC_COOKIE;
  return headers;
}

function rustaviHeaders(env) {
  const headers = {
    ...baseHeaders(env),
    Referer: "https://rustavi-transit.azrycloud.com/",
    Origin: "https://rustavi-transit.azrycloud.com",
  };
  // Cookie სავალდებულო შეიძლება იყოს (production capture-ით
  // დადასტურებული), მაგრამ ჩვენ ჯერ არ გვაქვს ცოცხალი მნიშვნელობა.
  // თუ მომავალში მოიპოვება — env.RUSTAVI_COOKIE-ში ჩაწერე.
  if (env.RUSTAVI_COOKIE) headers["Cookie"] = env.RUSTAVI_COOKIE;
  if (env.RUSTAVI_API_KEY) headers["X-api-key"] = env.RUSTAVI_API_KEY;
  return headers;
}

/* ერთი stop-id-ის დამუშავება — რომელ ქალაქს ეკუთვნის, იმის
   მიხედვით ვირჩევთ base-URL-სა და header-ებს. */
async function fetchOne(id, env) {
  const isRustavi = id.startsWith(RUSTAVI_PREFIX);
  const realId = isRustavi ? id.slice(RUSTAVI_PREFIX.length) : id;
  const base = isRustavi ? RUSTAVI_BASE : TBILISI_BASE;
  const headers = isRustavi ? rustaviHeaders(env) : tbilisiHeaders(env);

  const res = await fetch(
    `${base}/${encodeURIComponent(realId)}/arrival-times?locale=ka&ignoreScheduledArrivalTimes=false`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(`upstream ${res.status} for ${id} (city=${isRustavi ? "rustavi" : "tbilisi"})`);
  }
  return res.json();
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam?.trim()) return Response.json({ error: "ids required" }, { status: 400 });

  let ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);

  // ვალიდაცია — ცნობილი stop-id უნდა იყოს VALID_STOP_IDS-ში (ორივე
  // ქალაქის stop-ები, გაერთიანებული key-ების sub-ID-ების ჩათვლით)
  ids = ids.filter((id) => VALID_STOP_IDS.size === 0 || VALID_STOP_IDS.has(id));

  if (!ids.length) return Response.json({ error: "no valid ids" }, { status: 400 });

  const results = await Promise.allSettled(ids.map((id) => fetchOne(id, env)));

  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const errors = results.filter((r) => r.status === "rejected").map((r) => String(r.reason));

  if (!ok.length) {
    console.error("[arrivals] all upstream calls failed:", errors);
    return Response.json({ error: "ttc upstream failed", details: errors }, { status: 502 });
  }

  if (errors.length > 0) {
    console.warn("[arrivals] partial failure:", errors);
  }

  return Response.json({ stops: ok });
}

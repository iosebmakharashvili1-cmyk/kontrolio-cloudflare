/* ============================================================
   functions/api/_customRoutes.js
   ------------------------------------------------------------
   მომხმარებლის მიერ შემოთავაზებული მარშრუტები — moderation
   queue-ით. მომხმარებელი ხატავს ხაზს რუკაზე, ურთავს გაჩერებებს,
   ირჩევს ტრანსპორტის ტიპს/მოდელს, აგზავნის — შენ (admin) Telegram
   ბოტში ხედავ და ✅/❌-ით ადასტურებ/უარყოფ.

   KV keys:
     customroute:<routeId>       → JSON (იხ. ქვემოთ სქემა)
     customroutes-index          → JSON: [routeId, ...] ყველა (ნებისმიერი სტატუსით)
     customroutes-approved-cache → JSON, დამტკიცებულების ქეში (5 წუთი)

   Route object schema:
     {
       id, status: "pending"|"approved"|"rejected",
       vehicleType: "bus"|"minibus",
       vehicleModel: string (იხ. VEHICLE_MODELS),
       routeNumber: "123" (მკაცრად 3 ციფრი),
       name: "დასაწყისი - დასასრული",
       description: string (მაქს 300 სიმბოლო),
       points: [[lat,lng], ...],
       stopLinks: [{ pointIndex, stopId|null, customLabel|null }, ...],
       authorSid, createdAt, moderatedAt|null
     }
   ============================================================ */

export const VEHICLE_MODELS = {
  bus: [
    { id: "man18c", label: "MAN Lion's City 18C (CNG, გარმონი)" },
    { id: "man12", label: "MAN Lion's City 12მ (CNG)" },
    { id: "bmc12", label: "BMC Procity 12მ (CNG)" },
    { id: "man10", label: "MAN 10მ (ლურჯი)" },
    { id: "isuzu8", label: "Isuzu Novociti Life 8მ" },
  ],
  minibus: [
    { id: "fordtransit", label: "Ford Transit (ლურჯი)" },
  ],
};

const MAX_POINTS = 500;
const MAX_DESCRIPTION_LEN = 300;
const MAX_NAME_LEN = 80;
const ROUTE_NUMBER_PATTERN = /^\d{3}$/;
const NAME_PATTERN = /^[a-zA-Zა-ჰ0-9 .,\-–_/()]{1,80}$/u;
const DESC_PATTERN = /^[a-zA-Zა-ჰ0-9 .,!?\-–_/()\n]{0,300}$/u;

export function isValidVehicle(vehicleType, vehicleModel) {
  const list = VEHICLE_MODELS[vehicleType];
  if (!list) return false;
  return list.some((m) => m.id === vehicleModel);
}

export function isValidRouteNumber(num) {
  return typeof num === "string" && ROUTE_NUMBER_PATTERN.test(num);
}

export function isValidName(name) {
  return typeof name === "string" && NAME_PATTERN.test(name.trim());
}

export function isValidDescription(desc) {
  if (desc === undefined || desc === null || desc === "") return true;
  return typeof desc === "string" && DESC_PATTERN.test(desc.trim()) && desc.length <= MAX_DESCRIPTION_LEN;
}

export function isValidPoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS) return false;
  return points.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      typeof p[0] === "number" &&
      typeof p[1] === "number" &&
      p[0] >= 41 && p[0] <= 42 &&   // თბილისის/რუსთავის რეგიონის grosso-modo lat-range
      p[1] >= 44 && p[1] <= 45.5    // ...და lng-range — sanity check, არა ზუსტი საზღვარი
  );
}

export function isValidStopLinks(stopLinks, pointsLength) {
  if (!Array.isArray(stopLinks)) return false;
  if (stopLinks.length > pointsLength) return false;
  return stopLinks.every((s) => {
    if (typeof s !== "object" || s === null) return false;
    if (typeof s.pointIndex !== "number" || s.pointIndex < 0 || s.pointIndex >= pointsLength) return false;
    if (s.stopId !== null && typeof s.stopId !== "string") return false;
    if (s.customLabel !== null && s.customLabel !== undefined) {
      if (typeof s.customLabel !== "string" || s.customLabel.length > 60) return false;
    }
    return true;
  });
}

function genId() {
  return "cr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function saveNewCustomRoute(env, data) {
  const id = genId();
  const record = {
    id,
    status: "pending",
    vehicleType: data.vehicleType,
    vehicleModel: data.vehicleModel,
    routeNumber: data.routeNumber,
    name: data.name.trim().slice(0, MAX_NAME_LEN),
    description: (data.description || "").trim().slice(0, MAX_DESCRIPTION_LEN),
    points: data.points,
    stopLinks: data.stopLinks || [],
    authorSid: data.authorSid,
    createdAt: Date.now(),
    moderatedAt: null,
  };

  await env.KV.put(`customroute:${id}`, JSON.stringify(record));

  const indexRaw = await env.KV.get("customroutes-index");
  const index = indexRaw ? JSON.parse(indexRaw) : [];
  index.push(id);
  await env.KV.put("customroutes-index", JSON.stringify(index));

  return record;
}

export async function getCustomRoute(env, id) {
  const raw = await env.KV.get(`customroute:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function setCustomRouteStatus(env, id, status) {
  const record = await getCustomRoute(env, id);
  if (!record) return null;
  record.status = status;
  record.moderatedAt = Date.now();
  await env.KV.put(`customroute:${id}`, JSON.stringify(record));
  if (status === "approved" || status === "rejected") {
    await env.KV.delete("customroutes-approved-cache");
  }
  return record;
}

export async function getApprovedCustomRoutes(env) {
  const cacheRaw = await env.KV.get("customroutes-approved-cache");
  if (cacheRaw) {
    try {
      const cached = JSON.parse(cacheRaw);
      if (Date.now() - cached.ts < 5 * 60 * 1000) return cached.routes;
    } catch (_) {}
  }

  const indexRaw = await env.KV.get("customroutes-index");
  const index = indexRaw ? JSON.parse(indexRaw) : [];
  const all = await Promise.all(index.map((id) => getCustomRoute(env, id)));
  const approved = all.filter((r) => r && r.status === "approved");

  await env.KV.put(
    "customroutes-approved-cache",
    JSON.stringify({ ts: Date.now(), routes: approved }),
    { expirationTtl: 600 }
  );

  return approved;
}

/* ---------- Telegram შეტყობინება ---------- */
export async function notifyTelegram(env, record) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("[customRoutes] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID არ არის დაყენებული — ვერ ეცნობება");
    return;
  }

  const vehicleLabel =
    (VEHICLE_MODELS[record.vehicleType] || []).find((m) => m.id === record.vehicleModel)?.label ||
    record.vehicleModel;

  const text =
    `🆕 <b>ახალი მარშრუტის შემოთავაზება</b>\n\n` +
    `<b>№${escapeHtmlTg(record.routeNumber)}</b> — ${escapeHtmlTg(record.name)}\n` +
    `${escapeHtmlTg(vehicleLabel)}\n` +
    (record.description ? `\n${escapeHtmlTg(record.description)}\n` : "") +
    `\nID: <code>${record.id}</code>`;

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ დამტკიცება", callback_data: `approve:${record.id}` },
            { text: "❌ უარყოფა", callback_data: `reject:${record.id}` },
          ],
        ],
      },
    }),
  }).catch((err) => console.error("[customRoutes] telegram notify failed:", err));
}

function escapeHtmlTg(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

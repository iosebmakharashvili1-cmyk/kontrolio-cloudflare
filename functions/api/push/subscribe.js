/* ============================================================
   functions/api/push/subscribe.js
   ------------------------------------------------------------
   POST /api/push/subscribe  — ახალი subscription + favorite stops
   DELETE /api/push/subscribe — unsubscribe (endpoint-ის მიხედვით)
   ============================================================ */

import { saveSubscription, deleteSubscription } from "../_webPush.js";
import { STOP_NAMES } from "../_stopNames.js";

// STOP_NAMES-ის key-ები ზოგან გაერთიანებულია "+"-ით (იხ. arrivals.js-ის
// იგივე კომენტარი) — ცალკეული sub-id-ებიც უნდა ცნოთ ვალიდაციისას.
const VALID_STOP_IDS = new Set();
for (const key of Object.keys(STOP_NAMES)) {
  key.split("+").forEach((sub) => VALID_STOP_IDS.add(sub));
}

export async function onRequestPost({ request, env }) {
  if (!env.KV) return Response.json({ error: "storage unavailable" }, { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { subscription, favoriteStopIds } = body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return Response.json({ error: "invalid subscription" }, { status: 400 });
  }

  const validFavorites = Array.isArray(favoriteStopIds)
    ? favoriteStopIds.filter((id) => VALID_STOP_IDS.has(id)).slice(0, 30)
    : undefined;

  await saveSubscription(env, subscription, validFavorites);
  return Response.json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!env.KV) return Response.json({ error: "storage unavailable" }, { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body?.endpoint) return Response.json({ error: "endpoint required" }, { status: 400 });

  await deleteSubscription(env, body.endpoint);
  return Response.json({ ok: true });
}

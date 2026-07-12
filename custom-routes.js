/* functions/api/custom-routes.js
   GET  /api/custom-routes           → approved routes (public)
   POST /api/custom-routes           → submit new route (goes to pending, notifies Telegram)
     body: { vehicleType, vehicleModel, routeNumber, name, description, points, stopLinks, sid }
*/

import { checkRateLimit } from "./_middleware.js";
import {
  isValidVehicle,
  isValidRouteNumber,
  isValidName,
  isValidDescription,
  isValidPoints,
  isValidStopLinks,
  saveNewCustomRoute,
  getApprovedCustomRoutes,
  deleteCustomRoute,
  notifyTelegram,
} from "./_customRoutes.js";

export async function onRequestGet({ env }) {
  const approved = await getApprovedCustomRoutes(env);
  // public API-ში authorSid-ს არ ვაბრუნებთ — შიდა identifier-ია
  const publicView = approved.map(({ authorSid, ...rest }) => rest);
  return Response.json(publicView);
}

/* ---------- წაშლა (admin-only) ----------
   DELETE /api/custom-routes?id=<routeId>
   Header: X-Admin-Password — უნდა ემთხვეოდეს env.ADMIN_PASSWORD-ს.
   ეს არ არის "ნამდვილი" auth-სისტემა — ერთი გაზიარებული პაროლია,
   საკმარისი ამ scale-ის internal admin-ფუნქციისთვის (Telegram
   ✅/❌-ის იგივე ნდობის დონე). */
export async function onRequestDelete({ request, env }) {
  const suppliedPassword = request.headers.get("X-Admin-Password");
  if (!env.ADMIN_PASSWORD || suppliedPassword !== env.ADMIN_PASSWORD) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const deleted = await deleteCustomRoute(env, id);
  if (!deleted) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") ||
             request.headers.get("X-Forwarded-For") || "unknown";
  const rl = await checkRateLimit(env, ip);
  if (!rl.ok) {
    return Response.json({ error: "სცადე რამდენიმე წუთში" }, { status: 429 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const { vehicleType, vehicleModel, routeNumber, name, description, isLoop, points, stopLinks, sid } = body || {};

  if (vehicleType !== "bus" && vehicleType !== "minibus") {
    return Response.json({ error: "vehicleType must be bus or minibus" }, { status: 400 });
  }
  if (!isValidVehicle(vehicleType, vehicleModel)) {
    return Response.json({ error: "invalid vehicleModel for this vehicleType" }, { status: 400 });
  }
  if (!isValidRouteNumber(routeNumber)) {
    return Response.json({ error: "routeNumber must be exactly 3 digits" }, { status: 400 });
  }
  if (!isValidName(name)) {
    return Response.json({ error: "invalid name (1-80 chars, letters/numbers/basic punctuation)" }, { status: 400 });
  }
  if (!isValidDescription(description)) {
    return Response.json({ error: "invalid description (max 300 chars)" }, { status: 400 });
  }
  if (!isValidPoints(points)) {
    return Response.json({ error: "invalid points (need 2-500 [lat,lng] pairs within Georgia bounds)" }, { status: 400 });
  }
  if (isLoop && points.length < 3) {
    return Response.json({ error: "loop routes need at least 3 points" }, { status: 400 });
  }
  if (!isValidStopLinks(stopLinks || [], points.length)) {
    return Response.json({ error: "invalid stopLinks" }, { status: 400 });
  }

  const safeSid = typeof sid === "string" ? sid.slice(0, 64) : null;

  const record = await saveNewCustomRoute(env, {
    vehicleType,
    vehicleModel,
    routeNumber,
    name,
    description,
    isLoop: !!isLoop,
    points,
    stopLinks: stopLinks || [],
    authorSid: safeSid,
  });

  await notifyTelegram(env, record);

  return Response.json({ id: record.id, status: record.status });
}

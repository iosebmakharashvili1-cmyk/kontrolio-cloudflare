/* functions/api/activity.js — GET /api/activity */
import { serviceDayKey } from "./_middleware.js";

export async function onRequestGet({ env }) {
  const day = serviceDayKey();
  const raw = await env.KV.get(`activity:${day}`);
  const list = raw ? JSON.parse(raw) : [];
  return Response.json([...list].reverse().slice(0, 100));
}

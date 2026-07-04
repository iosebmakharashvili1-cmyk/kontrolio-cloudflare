/* functions/api/health.js — GET /api/health */
export async function onRequestGet() {
  return Response.json({ ok: true, time: new Date().toISOString() });
}

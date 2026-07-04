/* functions/api/heartbeat.js — GET /api/heartbeat?sid=<sid>
   KV: hb:<sid> → "1"  (TTL 25 წმ)
   online = KV.list("hb:").keys.length */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  if (!sid) return Response.json({ error: "sid required" }, { status: 400 });
  const safeSid = sid.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeSid) return Response.json({ error: "invalid sid" }, { status: 400 });
  await env.KV.put(`hb:${safeSid}`, "1", { expirationTtl: 60 });
  const listed = await env.KV.list({ prefix: "hb:" });
  return Response.json({ online: listed.keys.length });
}

/* functions/api/online.js — GET /api/online */
export async function onRequestGet({ env }) {
  const listed = await env.KV.list({ prefix: "hb:" });
  return Response.json({ online: listed.keys.length });
}

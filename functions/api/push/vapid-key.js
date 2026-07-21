/* functions/api/push/vapid-key.js — GET /api/push/vapid-key
   Public key-ს frontend-ი subscribe-ის დროს ითხოვს (applicationServerKey).
   Private key ცალკე, secret env variable-ადაა — არასდროს გამოაქვს აქედან. */
export async function onRequestGet({ env }) {
  if (!env.VAPID_PUBLIC_KEY) {
    return Response.json({ error: "push not configured" }, { status: 503 });
  }
  return Response.json({ publicKey: env.VAPID_PUBLIC_KEY });
}

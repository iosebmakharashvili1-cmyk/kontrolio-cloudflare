/* ============================================================
   functions/api/_webPush.js
   ------------------------------------------------------------
   Push subscription-ების შენახვა და გაგზავნის helper-ები.
   @block65/webcrypto-web-push იყენებს Web Crypto API-ს (არა
   Node.js-ის crypto მოდულს), ამიტომ Cloudflare Workers-ზეც
   უპრობლემოდ მუშაობს.

   KV storage schema:
     push:sub:<subscriptionEndpointHash>
       → JSON: { subscription, favoriteStopIds: [...], createdAt }
       (permanent — TTL არაა, subscription თავად browser-ის მხრიდან
       ცოცხლდება წაშლამდე)

     push:favorites-index:<stopId>
       → JSON: [subscriptionEndpointHash, ...]
       (რომელი subscriber-ები არიან დაინტერესებული ამ stop-ით —
       ეს საშუალებას გვაძლევს "inspector" report-ისას სწრაფად
       ვიპოვოთ ვისთვის გავაგზავნოთ push, ყველა subscriber-ის
       scan-ის გარეშე)
   ============================================================ */

import { buildPushPayload } from "@block65/webcrypto-web-push";

/* Endpoint URL-ის მოკლე, სტაბილური hash — subscription-ის unique
   key-ად გამოსაყენებლად (თვითონ endpoint URL ძალიან გრძელია KV
   key-ისთვის პირდაპირ გამოსაყენებლად, და შეიცავს სპეც სიმბოლოებს). */
async function hashEndpoint(endpoint) {
  const enc = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function getVapidKeys(env) {
  return {
    subject: env.VAPID_SUBJECT || "mailto:admin@kontrolio.live",
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

/* ახალი subscription-ის რეგისტრაცია ან არსებულის განახლება
   (favoriteStopIds-ის ჩათვლით). იძახება /api/push/subscribe-დან. */
export async function saveSubscription(env, subscription, favoriteStopIds) {
  const id = await hashEndpoint(subscription.endpoint);
  const key = `push:sub:${id}`;

  const existingRaw = await env.KV.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  const prevFavorites = existing?.favoriteStopIds || [];

  const record = {
    subscription,
    favoriteStopIds: favoriteStopIds || prevFavorites,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await env.KV.put(key, JSON.stringify(record));

  // favorites-index-ის განახლება — წინა სიაში ყოფნა და ახალში
  // აღარ-ყოფნა ცალკე უნდა მოვაშოროთ ცალკეული stop-ის ინდექსიდან
  const nextFavorites = record.favoriteStopIds;
  const removed = prevFavorites.filter((s) => !nextFavorites.includes(s));
  const added = nextFavorites.filter((s) => !prevFavorites.includes(s));

  await Promise.all([
    ...removed.map((stopId) => removeFromFavoritesIndex(env, stopId, id)),
    ...added.map((stopId) => addToFavoritesIndex(env, stopId, id)),
  ]);

  return id;
}

async function addToFavoritesIndex(env, stopId, subId) {
  const key = `push:favorites-index:${stopId}`;
  const raw = await env.KV.get(key);
  const list = raw ? JSON.parse(raw) : [];
  if (!list.includes(subId)) list.push(subId);
  await env.KV.put(key, JSON.stringify(list));
}

async function removeFromFavoritesIndex(env, stopId, subId) {
  const key = `push:favorites-index:${stopId}`;
  const raw = await env.KV.get(key);
  if (!raw) return;
  const list = JSON.parse(raw).filter((id) => id !== subId);
  if (list.length) {
    await env.KV.put(key, JSON.stringify(list));
  } else {
    await env.KV.delete(key);
  }
}

/* subscription-ის სრული წაშლა (unsubscribe) — favorites-index-იდანაც */
export async function deleteSubscription(env, endpoint) {
  const id = await hashEndpoint(endpoint);
  const key = `push:sub:${id}`;
  const raw = await env.KV.get(key);
  if (raw) {
    const rec = JSON.parse(raw);
    await Promise.all((rec.favoriteStopIds || []).map((stopId) => removeFromFavoritesIndex(env, stopId, id)));
  }
  await env.KV.delete(key);
}

/* ერთ subscriber-ზე push-ის გაგზავნა. 404/410 პასუხი ნიშნავს, რომ
   subscription აღარაა ვალიდური (მომხმარებელმა notification-ები
   გამორთო, ან browser-მა subscription გააუქმა) — ასეთ შემთხვევაში
   ავტომატურად ვასუფთავებთ KV-დანაც, რომ მომავალში აღარ ვცადოთ. */
async function sendToSubscriber(env, subId, record, message) {
  const vapid = getVapidKeys(env);
  try {
    const payload = await buildPushPayload(message, record.subscription, vapid);
    const res = await fetch(record.subscription.endpoint, payload);
    if (res.status === 404 || res.status === 410) {
      await deleteSubscription(env, record.subscription.endpoint);
      return { ok: false, expired: true };
    }
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* კონკრეტული stop-ის favorite-სუბსქრაიბერებისთვის push-ის
   გაგზავნა — "inspector" report-ისას გამოსაყენებელი. */
export async function notifyStopSubscribers(env, stopId, message) {
  const indexKey = `push:favorites-index:${stopId}`;
  const raw = await env.KV.get(indexKey);
  if (!raw) return { sent: 0 };

  const subIds = JSON.parse(raw);
  const records = await Promise.all(
    subIds.map(async (id) => [id, await env.KV.get(`push:sub:${id}`)])
  );

  let sent = 0;
  await Promise.all(
    records.map(async ([id, rawRec]) => {
      if (!rawRec) return;
      const record = JSON.parse(rawRec);
      const result = await sendToSubscriber(env, id, record, message);
      if (result.ok) sent += 1;
    })
  );
  return { sent, total: subIds.length };
}

/* ყველა registered subscriber-ისთვის broadcast — ახალი მარშრუტის
   დამატებისას გამოსაყენებელი. KV-ს list()-ს ვიყენებთ ყველა
   push:sub:*-ის მოსაძებნად. Cloudflare KV-ის list() 1000-მდე key-ს
   აბრუნებს გვერდზე — cursor-ით ვიმეორებთ საჭიროებისას. */
export async function broadcastToAllSubscribers(env, message) {
  let sent = 0;
  let total = 0;
  let cursor;
  do {
    const page = await env.KV.list({ prefix: "push:sub:", cursor });
    const records = await Promise.all(
      page.keys.map(async (k) => [k.name.replace("push:sub:", ""), await env.KV.get(k.name)])
    );
    total += records.length;
    await Promise.all(
      records.map(async ([id, rawRec]) => {
        if (!rawRec) return;
        const record = JSON.parse(rawRec);
        const result = await sendToSubscriber(env, id, record, message);
        if (result.ok) sent += 1;
      })
    );
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return { sent, total };
}

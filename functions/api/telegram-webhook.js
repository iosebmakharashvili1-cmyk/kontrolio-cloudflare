/* functions/api/telegram-webhook.js
   POST /api/telegram-webhook
   Telegram-ი აქეთ აგზავნის callback_query-ს, როცა admin ✅/❌-ზე დააჭერს.

   ეს endpoint-ი Telegram-ის webhook-ად უნდა დარეგისტრირდეს ერთხელ
   (იხ. README/setup ინსტრუქცია) — მას შემდეგ ავტომატურად მუშაობს.

   უსაფრთხოება: request-ს ვამოწმებთ, რომ ნამდვილად Telegram-იდან
   მოვიდა — secret token header-ით (Telegram-ის officially მხარდაჭერილი
   მექანიზმი webhook-ების დასაცავად spoofing-ისგან). */

import { setCustomRouteStatus, getCustomRoute } from "./_customRoutes.js";

export async function onRequestPost({ request, env }) {
  // Telegram webhook secret ვალიდაცია — ვინმემ ამ URL-ზე პირდაპირ
  // POST რომ არ გამოგზავნოს route-ების ყალბად დასამტკიცებლად/უარსაყოფად
  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let update;
  try { update = await request.json(); }
  catch { return new Response("bad request", { status: 400 }); }

  const cq = update.callback_query;
  if (!cq || !cq.data) {
    return Response.json({ ok: true }); // სხვა ტიპის update, უბრალოდ vignette
  }

  const [action, routeId] = cq.data.split(":");
  if (!routeId || (action !== "approve" && action !== "reject")) {
    return Response.json({ ok: true });
  }

  const newStatus = action === "approve" ? "approved" : "rejected";
  const updated = await setCustomRouteStatus(env, routeId, newStatus);

  // Telegram-ს ვპასუხობთ callback_query-ს დასადასტურებლად (loading-spinner-ის მოსაშორებლად)
  const ackUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  await fetch(ackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: cq.id,
      text: updated
        ? newStatus === "approved" ? "დამტკიცდა ✅" : "უარყოფილია ❌"
        : "მარშრუტი ვერ მოიძებნა",
    }),
  }).catch(() => {});

  // ორიგინალი მესიჯის ტექსტს ვამატებთ სტატუსს, ღილაკებს ვშლით
  if (updated && cq.message) {
    const editUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`;
    await fetch(editUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: newStatus === "approved" ? "✅ დამტკიცებულია" : "❌ უარყოფილია", callback_data: "noop" }],
          ],
        },
      }),
    }).catch(() => {});
  }

  return Response.json({ ok: true });
}

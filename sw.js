/* ============================================================
   sw.js — Kontrolio Service Worker
   ------------------------------------------------------------
   პასუხისმგებელია მხოლოდ push notification-ებზე (არა offline
   caching-ზე — Kontrolio-ს რეალურ დროში მონაცემები სჭირდება,
   ამიტომ agressive cache-ი აქ განზრახ არ ინერგება).

   ეს ფაილი root-ში უნდა იყოს განთავსებული (არა /js/sw.js და
   ა.შ.), რომ default scope მთელი site-ზე გავრცელდეს.
   ============================================================ */

self.addEventListener("install", (event) => {
  // ახალი SW-ის დაუყოვნებელი აქტივაცია, ძველი ტაბების დახურვის
  // მოლოდინის გარეშე — push-ის ფუნქციონალობისთვის ეს უსაფრთხოა
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Push event — სერვერიდან მოსული შეტყობინების გამოჩენა.
   payload-ის ფორმატი განსაზღვრულია functions/api-ის push-გამგზავნ
   კოდში (_webPush.js) — { title, body, url, tag, icon }. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "Kontrolio", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Kontrolio";
  const options = {
    body: data.body || "",
    icon: "/apple-touch-icon.png",
    badge: "/favicon-32.png",
    // tag-ით ერთი და იმავე გაჩერების/თემის ორმაგი შეტყობინება
    // ერთმანეთს overwrite-ავს ნოტიფიკაციების პანელში ისე, რომ
    // spam-ის შეგრძნება არ შეიქმნას
    tag: data.tag || "kontrolio-generic",
    data: { url: data.url || "/" },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ნოტიფიკაციაზე დაწკაპუნება — უკვე ღია ტაბს ფოკუსირებს, თუ
   არსებობს, თორემ ახალს ხსნის. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

/* push subscription-ის ვადის გასვლა/გაუქმება ბრაუზერის მხრიდან —
   ეს ხდება ძალიან იშვიათად (მაგ. browser-მა key rotation
   გააკეთა). ამ შემთხვევაში ავტომატურად ვცდილობთ ხელახლა
   subscribe-ს და განახლებული subscription-ის სერვერზე გაგზავნას. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey = event.oldSubscription
          ? event.oldSubscription.options.applicationServerKey
          : null;
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: newSub.toJSON() }),
        });
      } catch (err) {
        // ვერაფერი გავაკეთეთ — მომხმარებელს მომდევნო ვიზიტზე
        // frontend-ის ლოგიკა თავიდან სთხოვს subscribe-ს, თუ საჭიროა
      }
    })()
  );
});

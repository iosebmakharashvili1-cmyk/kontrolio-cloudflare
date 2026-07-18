/* ============================================================
   functions/api/_patternHistory.js
   ------------------------------------------------------------
   გრძელვადიანი (არა-27-საათიანი) ისტორიის აგრეგირება — მიზანი:
   "ამ გაჩერებაზე ამ დღეს/საათებში ისტორიულად რამდენად ხშირად იყო
   კონტროლიორი". ჩვეულებრივი report-ები (reports.js) 27 საათში
   იშლება KV-დან — ეს ცალკე, permanent key-ებია.

   KV keys (არასდროს იშლება TTL-ით):
     pattern:<stopId>:<dayOfWeek>:<hourBucket>
       → JSON: { inspectorCount, totalCount, lastUpdated }
       dayOfWeek: 0(კვირა)-6(შაბათი), hourBucket: 0-11 (2სთ თითო)

   დიზაინის არჩევანი — ვინახავთ RAW report-ების ისტორიის ნაცვლად
   უბრალო counter-ებს (increment-only), რომ:
   1. Storage არ იზრდება წლების განმავლობაშიც (ფიქსირებული რაოდენობა
      key — stops × 7 დღე × 12 ბაკეტი)
   2. KV-ის write-ები იაფია (put ერთხელ თითო report-ზე)
   3. "Confidence" ბუნებრივად იზრდება მეტი მონაცემით — არ გვჭირდება
      ძველი მონაცემის წაშლა/rotation

   ნაკლი — ეს არ იძლევა "ბოლო კვირის ტრენდის" ცალკე ჩვენების
   საშუალებას (ყველა კვირა თანაბრადაა შერეული ჯამში). ეს მისაღები
   ტრეიდ-ოფია ამ ეტაპზე; საჭიროების შემთხვევაში მომავალში შეიძლება
   decay-ის დამატება (ძველი მონაცემის თანდათანობითი წონის შემცირება).
   ============================================================ */

import { patternBucketKey } from "./_middleware.js";

const MIN_SAMPLES_FOR_CONFIDENCE = 4; // ამაზე ნაკლები მონაცემით ალბათობას არ ვაჩვენებთ

/* ერთი report-ის დამატება ისტორიულ სტატისტიკაში. ეს გამოიძახება
   reports.js-ის POST handler-იდან, ჩვეულებრივი report-ის ჩაწერის
   პარალელურად. ჩავარდნისას (KV-ის დროებითი შეცდომა) არ vagenerirebt
   exception-ს — ისტორიის დაგროვება "best effort"-ია და არასდროს
   უნდა ჩაშალოს მთავარი report-submission flow. */
export async function recordPatternSample(env, stopId, status, date = new Date()) {
  if (!env.KV) return;
  try {
    const bucket = patternBucketKey(date);
    const key = `pattern:${stopId}:${bucket}`;
    const raw = await env.KV.get(key);
    const rec = raw ? JSON.parse(raw) : { inspectorCount: 0, totalCount: 0 };
    rec.totalCount += 1;
    if (status === "inspector") rec.inspectorCount += 1;
    rec.lastUpdated = Date.now();
    await env.KV.put(key, JSON.stringify(rec));
  } catch (err) {
    // საჭიროების შემთხვევაში აქ log-ის დამატება შეიძლება, მაგრამ
    // throw არასდროს — ეს fire-and-forget აგრეგაციაა
  }
}

/* მოცემული stop-ისთვის და (ნაგულისხმევად) ამჟამინდელი დღე/საათის
   ბაკეტისთვის ისტორიული სტატისტიკის წამოღება. */
export async function getPatternStats(env, stopId, date = new Date()) {
  if (!env.KV) return null;
  const bucket = patternBucketKey(date);
  const key = `pattern:${stopId}:${bucket}`;
  const raw = await env.KV.get(key);
  if (!raw) return null;
  const rec = JSON.parse(raw);
  if (rec.totalCount < MIN_SAMPLES_FOR_CONFIDENCE) return null; // ჯერ არასაკმარისი მონაცემი
  return {
    probability: rec.inspectorCount / rec.totalCount, // 0..1
    sampleSize: rec.totalCount,
    bucket,
  };
}

/* რამდენიმე stop-ისთვის ერთდროულად (მთელი მარშრუტისთვის ან
   ეკრანზე ხილული გაჩერებებისთვის) — Promise.all-ით პარალელურად. */
export async function getPatternStatsForStops(env, stopIds, date = new Date()) {
  if (!env.KV || !stopIds.length) return {};
  const entries = await Promise.all(
    stopIds.map(async (id) => [id, await getPatternStats(env, id, date)])
  );
  const out = {};
  for (const [id, stats] of entries) {
    if (stats) out[id] = stats;
  }
  return out;
}

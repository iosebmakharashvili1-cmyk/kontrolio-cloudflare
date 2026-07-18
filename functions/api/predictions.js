/* ============================================================
   functions/api/predictions.js — GET /api/predictions?ids=<id1,id2,...>
   ------------------------------------------------------------
   აბრუნებს ისტორიულ ალბათობას ("ამ დღეს/დროს ამ გაჩერებაზე რამდენად
   ხშირად იყო კონტროლიორი"), _patternHistory.js-ის გრძელვადიანი
   (permanent) KV-სტატისტიკის საფუძველზე. მხოლოდ იმ stop-ებისთვის
   ბრუნდება მონაცემი, რომლებსაც საკმარისი sample-size აქვთ
   (იხ. MIN_SAMPLES_FOR_CONFIDENCE) — თორემ 1-2 ისტორიულ ჩანაწერზე
   დაფუძნებული "78% ალბათობა" შეცდომაში შემყვან სტატისტიკას იძლევა.

   → { "<stopId>": { probability: 0.62, sampleSize: 14, bucket: "2:6" } }

   stop-ები, რომლებზეც მონაცემი არაა (ან ჯერ არასაკმარისია), out
   ობიექტში საერთოდ არ ჩნდება — frontend-მა ეს "პროგნოზი არ არსებობს"
   ნიშნად უნდა მიიღოს, არა როგორც "0% ალბათობა".
   ============================================================ */

import { getPatternStatsForStops } from "./_patternHistory.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam?.trim()) return Response.json({ error: "ids required" }, { status: 400 });

  // stops-ის ერთდროული query — ეკრანზე ხილული ყველა მარკერისთვის
  // ერთბაშად, ცალკეული request-ების მაგივრად. გონივრული ზედა ზღვარი
  // (60), რომ ერთმა request-მა ბევრ KV-read-ს არ დაატვირთოს.
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (!ids.length) return Response.json({ error: "no valid ids" }, { status: 400 });

  const stats = await getPatternStatsForStops(env, ids);
  return Response.json(stats);
}

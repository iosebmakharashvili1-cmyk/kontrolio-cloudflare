/* functions/api/nickname.js
   POST /api/nickname
   body: { sid, nickname }
   → { nickname } | { error }

   Rate-limited ისევე, როგორც reports — რომ ვინმემ nickname-ის
   მასობრივი შეცვლით KV-ის write-ლიმიტი არ ამოწუროს. */

import { checkRateLimit } from "./_middleware.js";
import { setNickname } from "./_leaderboard.js";

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") ||
             request.headers.get("X-Forwarded-For") || "unknown";

  const rl = await checkRateLimit(env, ip);
  if (!rl.ok) {
    return Response.json({ error: "სცადე რამდენიმე წუთში" }, { status: 429 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }

  const { sid, nickname } = body || {};
  const safeSid = typeof sid === "string" ? sid.slice(0, 64) : null;
  if (!safeSid) {
    return Response.json({ error: "sid is required" }, { status: 400 });
  }
  if (typeof nickname !== "string" || !nickname.trim()) {
    return Response.json({ error: "nickname is required" }, { status: 400 });
  }

  const saved = await setNickname(env, safeSid, nickname);
  if (!saved) {
    return Response.json(
      { error: "მეტსახელი უნდა იყოს 1-20 სიმბოლო, მხოლოდ ასოები/ციფრები/space" },
      { status: 400 }
    );
  }

  return Response.json({ nickname: saved });
}

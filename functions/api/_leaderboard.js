/* ============================================================
   functions/api/_leaderboard.js
   ------------------------------------------------------------
   ანონიმური, მუდმივი ლიდერბორდი — ქულა ეძლევა მხოლოდ იმას, ვინც
   პირველი აქცევს გაჩერებას "კონტროლიორზე" (იხ. reports.js).

   KV keys:
     score:<sid>          → string (number), მუდმივი (TTL არ აქვს)
     nickname:<sid>        → string, მომხმარებლის თვითონარჩეული სახელი
     leaderboard-cache      → JSON, ტოპ 20 + timestamp (5 წუთიანი ქეში)

   Nickname-ს ვინახავთ ცალკე key-ად (არა score-თან ერთად ერთ JSON-ში),
   რომ score-ის განახლება და nickname-ის განახლება ერთმანეთს არ
   დაეჯახოს concurrent request-ების დროს.
   ============================================================ */

const NICKNAME_MAX_LEN = 20;
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 წუთი
const LEADERBOARD_TOP_N = 20;

/* ---------- Nickname ვალიდაცია ----------
   მხოლოდ ქართული/ლათინური ასოები, ციფრები, space, ზოგიერთი სიმბოლო —
   HTML/script injection-ის საშუალება საერთოდ არ რჩება. */
const NICKNAME_PATTERN = /^[a-zA-Zა-ჰ0-9 _\-.!?★☆]{1,20}$/u;

export function isValidNickname(name) {
  return typeof name === "string" && NICKNAME_PATTERN.test(name.trim());
}

export async function setNickname(env, sid, nickname) {
  const trimmed = nickname.trim().slice(0, NICKNAME_MAX_LEN);
  if (!isValidNickname(trimmed)) return null;
  await env.KV.put(`nickname:${sid}`, trimmed);
  return trimmed;
}

export async function getNickname(env, sid) {
  return (await env.KV.get(`nickname:${sid}`)) || null;
}

/* ---------- ქულის მინიჭება ----------
   "პირველობის" ქულა — ერთხელ ერთ report-ზე. score:<sid> უბრალო
   counter-ია KV-ში; KV-ს ატომური increment არა აქვს, მაგრამ ეს
   საკმარისად იშვიათი მოვლენაა (თითო გაჩერებაზე დღეში მაქსიმუმ
   ერთხელ), რომ race condition-ის რისკი უმნიშვნელოა. */
export async function awardFirstReportPoint(env, sid) {
  const key = `score:${sid}`;
  const raw = await env.KV.get(key);
  const current = raw ? parseInt(raw, 10) : 0;
  await env.KV.put(key, String(current + 1));
  // ლიდერბორდის ქეში მოძველდა — შემდეგი მოთხოვნისას თავად განახლდება
  return true;
}

export async function getScore(env, sid) {
  const raw = await env.KV.get(`score:${sid}`);
  return raw ? parseInt(raw, 10) : 0;
}

/* ---------- ლიდერბორდის აგება ----------
   KV.list-ს არ აქვს "სორტირება მნიშვნელობით" — ამიტომ ყველა score:*
   key-ს ვკითხულობთ და მემორიაში ვალაგებთ. ეს string-heavy ოპერაციაა,
   ამიტომ 5 წუთიანი ქეშით ვიცავთ read-ების რაოდენობას (KV-ს ფასიანი
   read-ლიმიტი აქვს უფასო tier-ზეც). */
export async function getLeaderboard(env) {
  const cacheRaw = await env.KV.get("leaderboard-cache");
  if (cacheRaw) {
    try {
      const cached = JSON.parse(cacheRaw);
      if (Date.now() - cached.ts < LEADERBOARD_CACHE_TTL_MS) {
        return cached.entries;
      }
    } catch (_) {
      /* ცუდი ქეში — თავიდან ვაგებთ */
    }
  }

  const listed = await env.KV.list({ prefix: "score:" });
  const entries = await Promise.all(
    listed.keys.map(async ({ name }) => {
      const sid = name.slice("score:".length);
      const scoreRaw = await env.KV.get(name);
      const score = scoreRaw ? parseInt(scoreRaw, 10) : 0;
      const nickname = await getNickname(env, sid);
      return { sid, score, nickname };
    })
  );

  entries.sort((a, b) => b.score - a.score);
  const top = entries.slice(0, LEADERBOARD_TOP_N);

  await env.KV.put(
    "leaderboard-cache",
    JSON.stringify({ ts: Date.now(), entries: top }),
    { expirationTtl: 600 } // 10 წუთი — cache-ის TTL ცოტა მეტია, ვიდრე "ახალი"-ს ზღვარი
  );

  return top;
}

/* functions/api/leaderboard.js
   GET /api/leaderboard?sid=<sid>
   → { top: [{nickname, score}, ...], me: {score, rank} | null }

   "ჩემი" პოზიცია ცალკე გამოითვლება (ტოპ 20-ის მიღმაც), რომ
   მომხმარებელმა თავისი ადგილი დაინახოს მაშინაც, თუ ტოპში არ არის. */

import { getLeaderboard, getScore, getNickname } from "./_leaderboard.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sid = url.searchParams.get("sid");
  const safeSid = sid ? sid.slice(0, 64) : null;

  const top = await getLeaderboard(env);
  const publicTop = top.map((e, i) => ({
    rank: i + 1,
    nickname: e.nickname || "ანონიმური",
    score: e.score,
  }));

  let me = null;
  if (safeSid) {
    const myScore = await getScore(env, safeSid);
    const myNickname = await getNickname(env, safeSid);
    const inTop = top.findIndex((e) => e.sid === safeSid);
    me = {
      score: myScore,
      nickname: myNickname,
      rank: inTop >= 0 ? inTop + 1 : null, // null = ტოპ 20-ს გარეთაა
    };
  }

  return Response.json({ top: publicTop, me });
}

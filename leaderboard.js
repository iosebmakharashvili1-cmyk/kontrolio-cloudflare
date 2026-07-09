/* ============================================================
   leaderboard.js — ლიდერბორდის ცალკე გვერდი
   ------------------------------------------------------------
   თვითკმარია: არ არის დამოკიდებული script.js-ზე ან Leaflet-ზე.
   იზიარებს იმავე localStorage გასაღებებს (sid, contrib count,
   თემა) და API endpoint-ებს, რაც მთავარი გვერდი, რომ მონაცემები
   ორივეგან თანმიმდევრული იყოს.
   ============================================================ */

const API_BASE = (() => {
  const { hostname, port } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port !== "3000") {
    return `http://${hostname}:3000/api`;
  }
  return "/api";
})();

let reportsCache = {};

/* ---------- სესიის იდენტიფიკატორი (იგივე გასაღები, რაც მთავარ გვერდზე) ---------- */
function getSid() {
  let sid = localStorage.getItem("_kontrolio_sid");
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem("_kontrolio_sid", sid);
  }
  return sid;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- თემა (light/dark) — იგივე ლოგიკა, რაც მთავარ გვერდზე ---------- */
const THEME_KEY = "kontrolio-theme";
const THEME_MANUAL_KEY = "kontrolio-theme-manual";

function getTbilisiHour() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tbilisi",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === "hour").value) % 24;
}
function isNightTime() {
  const h = getTbilisiHour();
  return h >= 0 && h < 7;
}
function getSystemTheme() {
  return isNightTime() ? "dark" : "light";
}
function getSavedTheme() {
  if (localStorage.getItem(THEME_MANUAL_KEY) === "true") {
    return localStorage.getItem(THEME_KEY) || "light";
  }
  return getSystemTheme();
}
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/* ---------- დღის გასაღები (Tbilisi calendar day) ---------- */
function tbilisiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi" }).format(date);
}

/* ---------- Reports (საჭიროა "დღეს დაეხმარე X ადამიანს"-ისთვის) ---------- */
async function refreshReportsFromServer() {
  try {
    const res = await fetch(`${API_BASE}/reports?sid=${encodeURIComponent(getSid())}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    reportsCache = await res.json();
    return true;
  } catch (err) {
    console.error("reports fetch failed:", err);
    return false;
  }
}

/* ---------- ლიდერბორდი ---------- */
async function fetchLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/leaderboard?sid=${encodeURIComponent(getSid())}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("leaderboard fetch failed:", err);
    return null;
  }
}

async function saveNickname(nickname) {
  const res = await fetch(`${API_BASE}/nickname`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sid: getSid(), nickname }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.nickname;
}

/* ============================================================
   წვლილის ქულა / ბეჯები (იგივე გასაღები/ლოგიკა, რაც script.js-ში)
   ============================================================ */
const CONTRIB_KEY = "kontrolio-contrib-count";

const CONTRIB_TIERS = [
  { min: 0,   emoji: "🌱", label: "ახალბედა" },
  { min: 5,   emoji: "🔍", label: "დამკვირვებელი" },
  { min: 15,  emoji: "🧭", label: "მეგზური" },
  { min: 30,  emoji: "⭐", label: "გამოცდილი" },
  { min: 60,  emoji: "🏅", label: "ექსპერტი" },
  { min: 100, emoji: "👑", label: "ლეგენდა" },
];

function getContribCount() {
  return parseInt(localStorage.getItem(CONTRIB_KEY), 10) || 0;
}
function tierIndexFor(count) {
  let idx = 0;
  for (let i = 0; i < CONTRIB_TIERS.length; i++) {
    if (count >= CONTRIB_TIERS[i].min) idx = i;
  }
  return idx;
}

const MY_CONTRIB_TODAY_KEY = "kontrolio-my-contrib-today";
function getMyContribToday() {
  const today = tbilisiDateKey();
  try {
    const raw = localStorage.getItem(MY_CONTRIB_TODAY_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.date === today && Array.isArray(data.stopIds)) return data;
    }
  } catch (_) {}
  return { date: today, stopIds: [], reportCount: 0 };
}
function computeHelpedToday() {
  const data = getMyContribToday();
  let helped = 0;
  data.stopIds.forEach((id) => {
    const r = reportsCache[id];
    if (r && typeof r.viewerCount === "number") helped += r.viewerCount;
  });
  return { helped, reportCount: data.reportCount || 0 };
}

function renderContribSection() {
  const emojiEl = document.getElementById("contribEmoji");
  const tierEl = document.getElementById("contribTier");
  const countEl = document.getElementById("contribCount");
  const barEl = document.getElementById("contribProgressBar");
  const nextEl = document.getElementById("contribNext");
  const todayEl = document.getElementById("contribToday");
  if (!emojiEl) return;

  const count = getContribCount();
  const idx = tierIndexFor(count);
  const tier = CONTRIB_TIERS[idx];
  const next = CONTRIB_TIERS[idx + 1];

  emojiEl.textContent = tier.emoji;
  tierEl.textContent = tier.label;
  countEl.textContent = count === 0
    ? "ჯერ არ გაგიგზავნია შეტყობინება"
    : `${count} შეტყობინება გაგზავნილი`;

  if (next) {
    const span = next.min - tier.min;
    const progressed = count - tier.min;
    barEl.style.width = `${Math.min(100, Math.round((progressed / span) * 100))}%`;
    nextEl.textContent = `${next.min - count} შეტყობინება დარჩა შემდეგ დონემდე: ${next.emoji} ${next.label}`;
  } else {
    barEl.style.width = "100%";
    nextEl.textContent = "მიაღწიე ყველაზე მაღალ დონეს — მადლობა წვლილისთვის! 👑";
  }

  if (todayEl) {
    const { helped, reportCount } = computeHelpedToday();
    if (reportCount === 0) {
      todayEl.textContent = "";
    } else if (helped > 0) {
      todayEl.textContent = `🙌 დღეს დაეხმარე მინიმუმ ${helped} ადამიანს (${reportCount} შეტყობინებით)`;
    } else {
      todayEl.textContent = `📍 დღეს გაგზავნე ${reportCount} შეტყობინება — მალე გამოჩნდება რამდენს დაეხმარები`;
    }
  }
}

/* ---------- საზოგადოების დღევანდელი აქტივობა ---------- */
function renderCommunitySection() {
  const el = document.getElementById("communityStats");
  if (!el) return;
  const entries = Object.values(reportsCache);
  if (entries.length === 0) {
    el.textContent = "დღეს ჯერ არავის შეუტყობინებია";
    return;
  }
  const totalReports = entries.reduce((sum, r) => sum + (r.reportsToday || 0), 0);
  const activeStops = entries.length;
  el.textContent = `დღეს გაგზავნილია ${totalReports} შეტყობინება ${activeStops} გაჩერებაზე`;
}

/* ============================================================
   ლიდერბორდი
   ============================================================ */
let lastLeaderboardMe = null;

function medalFor(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return null;
}

async function renderLeaderboardSection() {
  const listEl = document.getElementById("leaderboardList");
  const meEl = document.getElementById("leaderboardMe");
  if (!listEl) return;

  const data = await fetchLeaderboard();
  if (!data) {
    listEl.innerHTML = `<p class="leaderboardEmpty">ვერ ჩაიტვირთა</p>`;
    return;
  }

  const { top, me } = data;
  lastLeaderboardMe = me || null;

  if (!top || top.length === 0) {
    listEl.innerHTML = `<p class="leaderboardEmpty">ჯერ არავის მოუპოვებია ქულა — იყავი პირველი! 🏆</p>`;
  } else {
    listEl.innerHTML = top
      .map((e) => {
        const medal = medalFor(e.rank);
        const rankLabel = medal || `#${e.rank}`;
        return `
          <div class="leaderboardItem">
            <span class="leaderboardItem__rank">${rankLabel}</span>
            <span class="leaderboardItem__name">${escapeHtml(e.nickname)}</span>
            <span class="leaderboardItem__score">${e.score}</span>
          </div>`;
      })
      .join("");
  }

  if (meEl) {
    if (!me || me.score === 0) {
      meEl.textContent = "შენ ჯერ ქულა არ გაქვს — პირველმა შეამჩნიე კონტროლიორი, მიიღე ქულა 🏆";
    } else {
      const posText = me.rank ? `ტოპ #${me.rank}` : "ტოპ 20-ს გარეთ";
      const nameText = me.nickname ? me.nickname : "(მეტსახელი არჩეული არაა)";
      meEl.textContent = `შენ: ${nameText} — ${me.score} ქულა (${posText})`;
    }
  }
}

/* ---------- Nickname prompt ---------- */
const nicknameOverlay = document.getElementById("nicknameOverlay");
const nicknameModal = document.getElementById("nicknameModal");
const nicknameInput = document.getElementById("nicknameInput");
const nicknameSave = document.getElementById("nicknameSave");
const nicknameSkip = document.getElementById("nicknameSkip");
const nicknameError = document.getElementById("nicknameError");

function openNicknamePrompt() {
  if (!nicknameOverlay) return;
  nicknameError.textContent = "";
  const meNickname = lastLeaderboardMe && lastLeaderboardMe.nickname;
  nicknameInput.value = meNickname || "";
  nicknameOverlay.classList.remove("hidden");
  nicknameModal.classList.remove("hidden");
  nicknameInput.focus();
}
function closeNicknamePrompt() {
  if (!nicknameOverlay) return;
  nicknameOverlay.classList.add("hidden");
  nicknameModal.classList.add("hidden");
}

if (nicknameSave) {
  nicknameSave.addEventListener("click", async () => {
    const value = nicknameInput.value.trim();
    if (!value) {
      nicknameError.textContent = "შეიყვანე მეტსახელი";
      return;
    }
    try {
      await saveNickname(value);
      localStorage.setItem("_kontrolio_has_nickname", "true");
      closeNicknamePrompt();
      renderLeaderboardSection();
    } catch (err) {
      nicknameError.textContent = err.message || "ვერ შეინახა — სცადე სხვა მეტსახელი";
    }
  });
}
if (nicknameSkip) {
  nicknameSkip.addEventListener("click", closeNicknamePrompt);
}
if (nicknameInput) {
  nicknameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nicknameSave.click();
  });
}

const leaderboardEditNickname = document.getElementById("leaderboardEditNickname");
if (leaderboardEditNickname) {
  leaderboardEditNickname.addEventListener("click", () => {
    openNicknamePrompt();
  });
}

/* ---------- გაშვება ---------- */
(async function init() {
  setTheme(getSavedTheme());

  await refreshReportsFromServer();
  renderContribSection();
  renderCommunitySection();
  renderLeaderboardSection();

  if (window.lucide) lucide.createIcons();
})();

/* ============================================================
   კონტროლიორების რუკა — script.js
   ------------------------------------------------------------
   DATA LAYER backend API-ს იძახებს (/api/reports, /api/activity).

   STOPS მასივი იტვირთება stops.js-დან. ერთი-და-იმავე-სახელის
   წყვილები (ერთი ფიზიკური გაჩერების ორი მიმართულება) გაერთიანებულია
   ერთ ჩანაწერში — `id` არის რეპორტინგის გასაღები (შესაძლოა
   კომპოზიტური, "id1+id2"), ხოლო `ids` შეიცავს ორიგინალ TTC
   stop-id(ebს), მომავალში მოსვლის დროების საპოვნელად:
   { id, ids: [...], name, lat, lng, types: ["bus","minibus"],
     routesBus: [...], routesMinibus: [...] }
   ============================================================ */

/* ============================================================
   ქალაქები (City switcher)
   ------------------------------------------------------------
   STOPS/ROUTES უკვე ჩატვირთულია (index.html-ის bootstrap script-მა
   აირჩია სწორი stops.js/routes.js თუ rustavi-stops.js/rustavi-routes.js
   localStorage-ის მიხედვით). აქ მხოლოდ ვიცით რომელ ქალაქზეა საუბარი,
   რომ რუკის ცენტრი/ზუმი და UI შესაბამისად მოვირგოთ. */
const CITY_KEY = "kontrolio-city";
const CITIES = {
  tbilisi: { label: "თბილისი", center: [41.7151, 44.8271], zoom: 12.5 },
  rustavi: { label: "რუსთავი", center: [41.5495, 45.0086], zoom: 13.3 },
};
const CURRENT_CITY = localStorage.getItem(CITY_KEY) === "rustavi" ? "rustavi" : "tbilisi";
const cityCfg = CITIES[CURRENT_CITY];

/* City switcher-ის DOM-ჯოხვა დამოუკიდებლად, სკრიპტის ყველაზე თავში —
   განზრახ event delegation-ით (document-ზე), რომ თუნდაც სხვა კოდის
   რომელიმე ნაწილმა მოგვიანებით შეცდომა გამოიწვიოს, ღილაკები მაინც
   იმუშაოს. try/catch — defense-in-depth. */
(function initCitySwitcher() {
  try {
    document.documentElement.setAttribute("data-city", CURRENT_CITY);
    const badge = document.getElementById("topbarCityBadge");
    if (badge && CURRENT_CITY === "rustavi") {
      badge.textContent = "· " + cityCfg.label;
    }
    document.querySelectorAll(".citySwitcher__btn").forEach((btn) => {
      if (btn.dataset.city === CURRENT_CITY) {
        btn.classList.add("citySwitcher__btn--active");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.setAttribute("aria-pressed", "false");
      }
    });
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".citySwitcher__btn");
      if (!btn) return;
      const city = btn.dataset.city;
      if (!city || city === CURRENT_CITY) return;
      localStorage.setItem(CITY_KEY, city);
      window.location.reload();
    });
  } catch (err) {
    console.error("city switcher init failed:", err);
  }
})();

const STOPS_BY_ID = {};
STOPS.forEach((s) => (STOPS_BY_ID[s.id] = s));

/* ---------- DATA LAYER (backend API) ---------- */
const API_BASE = (() => {
  const { hostname, port } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port !== "3000") {
    return `http://${hostname}:3000/api`;
  }
  return "/api";
})();
let reportsCache = {};

/* ---------- სესიის იდენტიფიკატორი ----------
   ერთი და იგივე sid გამოიყენება heartbeat-ისთვის (ონლაინ მთვლელი),
   report-ების დადასტურების დათვლისთვის, და ლიდერბორდის ქულებისთვის.
   localStorage-ში ინახება (არა sessionStorage), რომ ტაბის დახურვის
   შემდეგაც იგივე "ანონიმური პიროვნება" დარჩეს — წინააღმდეგ
   შემთხვევაში ქულები ყოველ ვიზიტზე თავიდან დაიწყებოდა. ეს მაინც
   მხოლოდ შემთხვევითი სტრინგია ამ მოწყობილობაზე/ბრაუზერზე — არ არის
   ანგარიში, არ არის დაკავშირებული პირად ინფორმაციასთან. */
function getSid() {
  let sid = localStorage.getItem("_kontrolio_sid");
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem("_kontrolio_sid", sid);
  }
  return sid;
}

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

function getReport(stopId) {
  return reportsCache[stopId] || null;
}

/* inspector report-ი 2 საათზე უფრო ძველია და "clear" არ მოჰყოლია — stale */
const STALE_MS = 2 * 60 * 60 * 1000;
function isStale(report) {
  if (!report || report.status !== "inspector") return false;
  return Date.now() - report.ts > STALE_MS;
}

async function setReport(stopId, status, stopName) {
  const res = await fetch(`${API_BASE}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopId, status, stopName, sid: getSid() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const saved = await res.json();
  reportsCache[stopId] = {
    status: saved.status,
    ts: saved.ts,
    confirmCount: saved.confirmCount,
    reportsToday: saved.reportsToday,
    viewerCount: (reportsCache[stopId] && reportsCache[stopId].viewerCount) || 0,
  };
  return { report: reportsCache[stopId], scored: !!saved.scored };
}

/* ---------- ლიდერბორდი (ანონიმური, მუდმივი ქულები) ---------- */
async function fetchLeaderboard() {
  try {
    const res = await fetch(`${API_BASE}/leaderboard?sid=${encodeURIComponent(getSid())}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json(); // { top: [...], me: {...} }
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

async function fetchActivity() {
  try {
    const res = await fetch(`${API_BASE}/activity`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("activity fetch failed:", err);
    return null;
  }
}

/* ---------- მოსვლის დროები (TTC/Rustavi API, server-ის მეშვეობით) ---------- */

/* სამუშაო საათები ორივე ქალაქისთვის — ცარიელი პასუხის სწორად
   ახსნისთვის (მაგ. ღამით "ავტობუსები არ დადის", და არა "შეცდომა"). */
const SERVICE_HOURS = {
  tbilisi: { startHour: 6, startMinute: 0, endHour: 24, endMinute: 0 }, // ~24/7-თან ახლოს, ღამისსაათებშიც ხშირად დადის
  rustavi: { startHour: 6, startMinute: 30, endHour: 20, endMinute: 30 }, // Metro Service+ ოფიციალური საათები
};

function isWithinServiceHours() {
  const hours = SERVICE_HOURS[CURRENT_CITY] || SERVICE_HOURS.tbilisi;
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const startMinutes = hours.startHour * 60 + hours.startMinute;
  const endMinutes = hours.endHour * 60 + hours.endMinute;
  return minutesNow >= startMinutes && minutesNow < endMinutes;
}

function extractArrivals(rawResponse) {
  const list = Array.isArray(rawResponse) ? rawResponse : [];
  if (!list.length) return [];
  const now = Date.now();
  return list
    .map((item) => {
      const route = item.shortName != null ? String(item.shortName) : "?";
      const direction = item.headsign != null ? String(item.headsign) : "";
      const isRealtime = item.realtime === true;
      const minutes = isRealtime
        ? item.realtimeArrivalMinutes
        : item.scheduledArrivalMinutes;
      if (typeof minutes !== "number") return null;
      const etaMs = now + minutes * 60000;
      return { route, direction, etaMs, isRealtime, minutes };
    })
    .filter((a) => a !== null && a.minutes >= 0)
    .sort((a, b) => a.etaMs - b.etaMs);
}

/* fetchArrivals აბრუნებს { arrivals, failed } ობიექტს ცალკეული
   მასივის ნაცვლად — ეს განასხვავებს "ნამდვილად ცარიელია" (failed:
   false, arrivals: []) და "upstream-მა ვერაფერი დააბრუნა" (failed:
   true) შემთხვევებს, რომ UI-მ სხვადასხვა მესიჯი აჩვენოს. */
async function fetchArrivals(ids) {
  try {
    const res = await fetch(`${API_BASE}/arrivals?ids=${encodeURIComponent(ids.join(","))}`, {
      cache: "no-store",
    });
    if (!res.ok) return { arrivals: [], failed: true };
    const data = await res.json();
    const stopsArr = Array.isArray(data.stops) ? data.stops : [];
    const all = stopsArr.flatMap((raw) => extractArrivals(raw));
    all.sort((a, b) => a.etaMs - b.etaMs);
    return { arrivals: all.slice(0, 4), failed: false };
  } catch (err) {
    console.error("arrivals fetch failed:", err);
    return { arrivals: [], failed: true };
  }
}

function formatEta(etaMs) {
  const minutes = Math.round((etaMs - Date.now()) / 60000);
  if (minutes < 0) return "ახლა";
  if (minutes === 0) return "0 წთ";
  if (minutes < 60) return `${minutes} წთ`;
  return clockTime(etaMs);
}

/* ---------- დროის ფორმატირება ---------- */
function timeAgo(ts) {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "ახლახანს";
  if (min < 60) return `${min} წუთის წინ`;
  const hrs = Math.floor(min / 60);
  return `${hrs} საათის წინ`;
}

function clockTime(ts) {
  return new Intl.DateTimeFormat("ka-GE", {
    timeZone: "Asia/Tbilisi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

/* სერვისის დღის გასაღები (თბილისის დროით) — server-ის serviceDayKey-ის
   იგივე ლოგიკა, "დღეს დაეხმარე X ადამიანს"-ის localStorage-ბაკეტისთვის. */
function tbilisiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tbilisi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function typeLabel(types) {
  const hasBus = types.includes("bus");
  const hasMini = types.includes("minibus");
  if (hasBus && hasMini) return "ავტობუსი + მინი";
  if (hasMini) return "მინიავტობუსი";
  return "ავტობუსი";
}

/* innerHTML-ში ჩასასმელი ნებისმიერი დინამიური სტრინგი (server-ის,
   TTC-ის, ან ჩვენი stops.js-ის მონაცემიდანაც) ამით ვატარებთ —
   defense-in-depth, რომ ერთმა "feed" ცვლილებამ მომავალში
   ისევ XSS არ გამოაჩინოს. */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ============================================================
   THEME SYSTEM (light / dark)
   ------------------------------------------------------------
   - ავტომატური: ღამით (00:00–07:00) dark, დანარჩენი light
   - ხელით toggle localStorage-ში ინახება
   - ბნელი რუკა მიიღწევა CSS filter-ით (style.css-ში)
   ============================================================ */
const THEME_KEY = "kontrolio-theme";
const THEME_MANUAL_KEY = "kontrolio-theme-manual";

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
  updateThemeIcon(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  localStorage.setItem(THEME_MANUAL_KEY, "true");
  setTheme(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("themeIcon");
  if (!icon) return;
  icon.setAttribute("data-lucide", theme === "dark" ? "moon" : "sun");
  if (window.lucide) lucide.createIcons();
}

/* ---------- რუკის ინიციალიზაცია ---------- */
const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  maxZoom: 19,
  zoomSnap: 0,               // 0 რთავს იდეალურად გლუვ (fractional) ზუმს თაჩპედზე და სქროლზე
  zoomDelta: 1,              // + და - ღილაკები სტანდარტულად 1 სრულ დონეს დააზუმებს (ბევრად ბუნებრივია)
  wheelPxPerZoomLevel: 100,  // რამდენად სწრაფად დაზუმოს მაუსის ბორბალმა (რაც მეტია რიცხვი, მით უფრო რბილია)
  zoomAnimation: true,
  markerZoomAnimation: true,
  fadeAnimation: true
}).setView(cityCfg.center, cityCfg.zoom);

L.control.zoom({ position: "bottomright", zoomInTitle: "რუკის მიახლოება", zoomOutTitle: "რუკის დაშორება" }).addTo(map);

/* ---------- Tile layers ---------- */
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

/* ---------- "ჩემი ლოკაცია" ---------- */
let userLocationMarker = null;

/* შენახული ლოკაცია localStorage-ში — მომდევნო ვიზიტზე ავტომატურად
   გამოჩნდეს, სანამ ბრაუზერისგან ახალი, ცოცხალი პოზიცია მოვა. */
const USER_LOCATION_KEY = "kontrolio-user-location";

function saveUserLocation(lat, lng) {
  try {
    localStorage.setItem(USER_LOCATION_KEY, JSON.stringify({ lat, lng, ts: Date.now() }));
  } catch (_) {}
}

function loadSavedUserLocation() {
  try {
    const raw = localStorage.getItem(USER_LOCATION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.lat !== "number" || typeof data.lng !== "number") return null;
    return data;
  } catch (_) {
    return null;
  }
}

function showUserLocation(lat, lng, { persist = true } = {}) {
  if (userLocationMarker) {
    userLocationMarker.setLatLng([lat, lng]);
  } else {
    userLocationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: '<div class="userDot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(map);
  }
  if (persist) saveUserLocation(lat, lng);
}

/* გვერდის ჩატვირთვისას წინა სესიის ლოკაცია მაშინვე ვაჩვენოთ
   (marker-ის სახით, ცენტრირების გარეშე), შემდეგ კი ცოცხალი
   პოზიციით განვაახლოთ თუ ბრაუზერი დართავს. */
function restoreSavedUserLocation() {
  const saved = loadSavedUserLocation();
  if (!saved) return;
  showUserLocation(saved.lat, saved.lng, { persist: false });
}

function tryAutoUpdateUserLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      showUserLocation(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      /* წყნარად ჩავარდეს — მომხმარებელს შენახული ლოკაცია მაინც უჩანს */
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 }
  );
}

const LocateControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd: function () {
    const btn = L.DomUtil.create("button", "leaflet-control locateBtn");
    btn.type = "button";
    btn.title = "ჩემი ლოკაცია";
    btn.setAttribute("aria-label", "ჩემი ლოკაცია");
    btn.innerHTML = "📍";
    L.DomEvent.disableClickPropagation(btn);

    btn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        showToast("გეოლოკაცია მხარდაუჭერელია 🙁");
        return;
      }
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          showUserLocation(latitude, longitude);
          map.setView([latitude, longitude], 16);
          btn.disabled = false;
        },
        () => {
          showToast("ლოკაციის წვდომა ვერ მოხერხდა 🙁");
          btn.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    return btn;
  },
});
map.addControl(new LocateControl());

/* ---------- კლასტერები ---------- */
const CLUSTER_COLORS = {
  inspector: "var(--red)",
  stale: "var(--amber)",
  clear: "var(--green)",
  unknown: "var(--bus-blue)",
};
/* რიგითობა განსაზღვრავს pie slice-ების თანმიმდევრობას */
const CLUSTER_STATUS_ORDER = ["inspector", "stale", "clear", "unknown"];

const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 55,
  disableClusteringAtZoom: 17,
  iconCreateFunction: (cluster) => {
    const childMarkers = cluster.getAllChildMarkers();

    /* თითოეული სტატუსის მარკერების დათვლა კლასტერში.
       "unknown" ფერად არ ითვლება — ისევე, როგორც თავდაპირველ ვერსიაში,
       მისი არსებობა pie-ს არ ცვლის და მხოლოდ მაშინ ჩანს (ლურჯად),
       თუ კლასტერში საერთოდ არაფერია მონიშნული. */
    const counts = { inspector: 0, stale: 0, clear: 0 };
    childMarkers.forEach((m) => {
      const s = m.options.reportStatus;
      if (s in counts) counts[s] += 1;
    });
    const coloredTotal = counts.inspector + counts.stale + counts.clear;
    const presentStatuses = CLUSTER_STATUS_ORDER.filter((s) => s !== "unknown" && counts[s] > 0);

    let bg;
    let extraCls = "";
    if (presentStatuses.length === 0) {
      /* არცერთი მონიშნული გაჩერება — ძველებურად ლურჯი */
      bg = CLUSTER_COLORS.unknown;
    } else if (presentStatuses.length === 1) {
      /* ერთი ფერი — მარტივი მთლიანი წრე, ისე როგორც ადრე იყო */
      const only = presentStatuses[0];
      bg = CLUSTER_COLORS[only];
      if (only === "inspector") extraCls = " clusterIcon--alert";
    } else {
      /* რამდენიმე ფერი ერთ არეალში — conic-gradient pie, პროპორციული
         წილებით, რომ თითოეული სტატუსი ვიზუალურად ჩანდეს */
      let acc = 0;
      const stops = presentStatuses.map((s) => {
        const from = (acc / coloredTotal) * 360;
        acc += counts[s];
        const to = (acc / coloredTotal) * 360;
        return `${CLUSTER_COLORS[s]} ${from}deg ${to}deg`;
      });
      bg = `conic-gradient(${stops.join(", ")})`;
      if (counts.inspector > 0) extraCls = " clusterIcon--alert";
    }

    return L.divIcon({
      html: `<div class="clusterIcon${extraCls}" style="background:${bg};"><span>${childMarkers.length}</span></div>`,
      className: "",
      iconSize: [38, 38],
    });
  },
});
map.addLayer(clusterGroup);

/* ============================================================
   გაჩერების მარშრუტების ხაზები (routes.js-დან)
   ------------------------------------------------------------
   selectStop-ის დროს ვხატავთ ამ გაჩერებაზე გამავალ ყველა
   ავტობუსის/მინის/სეზონურ ხაზს — ფერი ტიპის მიხედვით,
   headsign-იანი tooltip-ით. deselectStop-ზე იფარება. */
const routeLinesLayer = L.layerGroup().addTo(map);

const ROUTE_LINE_COLORS = {
  bus: CURRENT_CITY === "rustavi" ? "#11518a" : "#2ec4b6",  // რუსთავი — TTC აპის ლურჯი; თბილისი — routeChip--bus მწვანე
  minibus: "#3f6683",   // ფოლადისფერი ლურჯი — routeChip--minibus (--bus-blue-სთან სინქრონში)
  seasonal: "#9333ea",  // იასამნისფერი — routeChip--seasonal
};

function routeColor(routeNum, routeDef) {
  if (routeDef.seasonal) return ROUTE_LINE_COLORS.seasonal;
  return routeDef.type === "minibus" ? ROUTE_LINE_COLORS.minibus : ROUTE_LINE_COLORS.bus;
}

function drawRouteLinesForStop(stop, highlightRoute = null) {
  routeLinesLayer.clearLayers();
  if (typeof ROUTES === "undefined") return;

  const allRouteNums = [
    ...(stop.routesBus || []),
    ...(stop.routesMinibus || []),
    ...(stop.routesSeasonal || []),
  ];
  const uniqueNums = [...new Set(allRouteNums)];

  uniqueNums.forEach((num) => {
    const def = ROUTES[num];
    if (!def || !Array.isArray(def.dirs)) return;
    const color = routeColor(num, def);
    const isDimmed = highlightRoute && num !== highlightRoute;

    def.dirs.forEach((dir) => {
      if (!Array.isArray(dir.coords) || dir.coords.length < 2) return;
      const line = L.polyline(dir.coords, {
        color,
        weight: isDimmed ? 3 : 5,
        opacity: isDimmed ? 0.25 : 0.9,
        lineJoin: "round",
      }).addTo(routeLinesLayer);
      line.bindTooltip(`${escapeHtml(num)} · ${escapeHtml(dir.headsign || "")}`, {
        sticky: true,
      });
      if (!isDimmed && highlightRoute) line.bringToFront();
    });
  });
}

function clearRouteLines() {
  routeLinesLayer.clearLayers();
}

/* ---------- მარკერები ---------- */
const markers = {};

const BUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/>
  <path d="M4 11h16"/>
  <circle cx="7.5" cy="19" r="1.5"/>
  <circle cx="16.5" cy="19" r="1.5"/>
</svg>`;

function statusClass(report) {
  if (!report) return "stopMarker--unknown";
  if (isStale(report)) return "stopMarker--stale";
  return report.status === "inspector" ? "stopMarker--inspector" : "stopMarker--clear";
}

/* ვიზუალური სტატუსი — ეს ის ფერია, რასაც მომხმარებელი მარკერზე რეალურად ხედავს
   (inspector/clear/stale/unknown), განსხვავებით report.status-გან, რომელიც
   stale-ს არ ითვალისწინებს. კლასტერების შეღებვა სწორედ ამაზეა დამოკიდებული. */
function visualStatus(report) {
  if (!report) return "unknown";
  if (isStale(report)) return "stale";
  return report.status === "inspector" ? "inspector" : "clear";
}

function buildIcon(report, isSelected) {
  const cls = `stopMarker ${statusClass(report)}${isSelected ? " stopMarker--selected" : ""}`;
  return L.divIcon({
    className: "",
    html: `<div class="${cls}">${BUS_SVG}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function renderAllMarkers() {
  STOPS.forEach((stop) => {
    const report = getReport(stop.id);
    const icon = buildIcon(report, stop.id === selectedStopId);

    if (markers[stop.id]) {
      markers[stop.id].setIcon(icon);
      markers[stop.id].options.reportStatus = visualStatus(report);
    } else {
      const marker = L.marker([stop.lat, stop.lng], {
        icon,
        reportStatus: visualStatus(report),
      });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        openSheet(stop.id);
      });
      markers[stop.id] = marker;
      clusterGroup.addLayer(marker);
    }
  });
  if (clusterGroup.refreshClusters) clusterGroup.refreshClusters();
}

function refreshMarker(stopId) {
  const report = getReport(stopId);
  const marker = markers[stopId];
  if (marker) {
    marker.setIcon(buildIcon(report, stopId === selectedStopId));
    marker.options.reportStatus = visualStatus(report);
    if (clusterGroup.refreshClusters) clusterGroup.refreshClusters(marker);
  }
}

/* ============================================================
   გაჩერების მონიშვნა (marker ring + peek bar)
   ------------------------------------------------------------
   მონიშვნა რჩება მანამ, სანამ სხვა გაჩერებას არ ავირჩევთ. ----- */
let selectedStopId = null;
let highlightedRoute = null;

function selectStop(stopId) {
  const prev = selectedStopId;
  if (prev === stopId) return;
  selectedStopId = stopId;
  highlightedRoute = null;
  if (prev) refreshMarker(prev);
  if (stopId) {
    refreshMarker(stopId);
    const stop = STOPS_BY_ID[stopId];
    if (stop) drawRouteLinesForStop(stop);
  } else {
    clearRouteLines();
  }
}

function deselectStop() {
  if (!selectedStopId) return;
  const prev = selectedStopId;
  selectedStopId = null;
  hidePeek();
  clearRouteLines();
  refreshMarker(prev);
}

/* ცარიელ ადგილას დაჭერისას მონიშვნა იხსნება */
map.on("click", () => {
  deselectStop();
});

/* ---------- Bottom sheet ---------- */
const overlay = document.getElementById("overlay");
const sheet = document.getElementById("sheet");
const sheetStopName = document.getElementById("sheetStopName");
const sheetStatusBanner = document.getElementById("sheetStatusBanner");
const sheetCaption = document.getElementById("sheetCaption");
const sheetRouteChips = document.getElementById("sheetRouteChips");
const arrivalsList = document.getElementById("arrivalsList");
const arrivalsCompact = document.getElementById("arrivalsCompact");
const btnInspector = document.getElementById("btnInspector");
const btnClear = document.getElementById("btnClear");
const sheetClose = document.getElementById("sheetClose");
const sheetPeek = document.getElementById("sheetPeek");
const sheetPeekName = document.getElementById("sheetPeekName");
const sheetPeekMain = document.getElementById("sheetPeekMain");
const sheetPeekDeselect = document.getElementById("sheetPeekDeselect");

let activeStopId = null;

function renderStatusBanner(report) {
  if (!report) {
    sheetStatusBanner.className = "statusBanner statusBanner--unknown";
    sheetStatusBanner.innerHTML = '<span class="statusDot statusDot--unknown"></span> სტატუსი უცნობია';
    sheetCaption.textContent = "ჯერ არავის შეუტყობინებია";
    return;
  }
  if (report.status === "inspector" && isStale(report)) {
    sheetStatusBanner.className = "statusBanner statusBanner--stale";
    sheetStatusBanner.innerHTML = '<span class="statusDot statusDot--stale"></span> შესაძლოა აღარ არის';
    sheetCaption.textContent = `ბოლო შეტყობინება: ${timeAgo(report.ts)} (2 სთ-ზე მეტია)`;
    return;
  }
  if (report.status === "inspector") {
    sheetStatusBanner.className = "statusBanner statusBanner--inspector";
    sheetStatusBanner.innerHTML = '<span class="statusDot statusDot--inspector"></span> კონტროლიორი დგას';
  } else {
    sheetStatusBanner.className = "statusBanner statusBanner--clear";
    sheetStatusBanner.innerHTML = '<span class="statusDot statusDot--clear"></span> თავისუფალია';
  }
  sheetCaption.textContent = buildCaptionText(report);
}

/* ---------- სანდოობის დონე (verification, არა raw report-count) ----------
   რამდენმა დამოუკიდებელმა სესიამ დაადასტურა იგივე სტატუსი მოკლე
   დროში — ეს ცვლის აღქმულ სანდოობას, არა თავად "ჯილდოს". */
function trustLabel(confirmCount) {
  if (confirmCount >= 4) return "მაღალი სანდოობა ✓✓";
  if (confirmCount >= 2) return "დადასტურებულია ✓";
  return null; // ერთი შეტყობინება — ჯერ დაუდასტურებელია, ეს ნორმალურია
}

function buildCaptionText(report) {
  const parts = [`ბოლო შეტყობინება: ${timeAgo(report.ts)}`];
  const trust = trustLabel(report.confirmCount || 1);
  if (trust) parts.push(trust);
  if (report.reportsToday > 1) parts.push(`დღეს ${report.reportsToday} შეტყობინება ამ გაჩერებაზე`);
  return parts.join(" · ");
}

function renderRouteChips(stop) {
  const busChips = (stop.routesBus || []).map(
    (r) => `<span class="routeChip routeChip--bus" data-route="${escapeHtml(r)}">${escapeHtml(r)}</span>`
  );
  const miniChips = (stop.routesMinibus || []).map(
    (r) => `<span class="routeChip routeChip--minibus" data-route="${escapeHtml(r)}">${escapeHtml(r)}</span>`
  );
  const seasonalChips = (stop.routesSeasonal || []).map(
    (r) => `<span class="routeChip routeChip--seasonal" data-route="${escapeHtml(r)}" title="სეზონური — ეროვნული გამოცდები">${escapeHtml(r)}</span>`
  );
  const all = [...busChips, ...miniChips, ...seasonalChips];
  sheetRouteChips.innerHTML = all.length
    ? all.join("")
    : `<span class="routeChip routeChip--empty">მარშრუტი უცნობია</span>`;
}

/* Route chip-ზე დაწკაპუნებით — მხოლოდ ის ხაზი გამოინათება რუკაზე
   და მხოლოდ იმ მარშრუტის მოსვლის დროები ჩანს (სია + კომპაქტური
   პრევიუ). მეორედ იმავე chip-ზე დაწკაპუნება ან სხვა chip-ის არჩევა
   უბრუნებს ყველა ხაზს/მოსვლას თანაბარ ხილვადობაზე. */
sheetRouteChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".routeChip[data-route]");
  if (!chip || !selectedStopId) return;
  const num = chip.dataset.route;
  highlightedRoute = highlightedRoute === num ? null : num;
  const stop = STOPS_BY_ID[selectedStopId];
  if (stop) drawRouteLinesForStop(stop, highlightedRoute);

  // chip-ების ვიზუალური active state — მხოლოდ არჩეული მარშრუტის
  // chip გამოირჩევა, დანარჩენები დაბინდულია (რუკის ხაზების
  // ქცევის იმიტაციით)
  sheetRouteChips.querySelectorAll(".routeChip[data-route]").forEach((c) => {
    c.classList.toggle("routeChip--active", highlightedRoute !== null && c.dataset.route === highlightedRoute);
    c.classList.toggle("routeChip--dimmed", highlightedRoute !== null && c.dataset.route !== highlightedRoute);
  });

  // თუ arrivals უკვე ჩატვირთულია იმ გაჩერებისთვის — ხელახლა ვხატავთ
  // ფილტრით, API-ს ხელახლა ვერ ვიძახებთ
  if (lastArrivalsResult && lastArrivalsStop) {
    renderArrivalsList(lastArrivalsResult, lastArrivalsStop);
    renderArrivalsCompact(lastArrivalsResult, lastArrivalsStop);
  }
});

function renderArrivalsList(result, stop) {
  const { arrivals: allArrivals, failed } = result;

  if (failed) {
    arrivalsList.innerHTML = `
      <div class="emptyState">
        <div class="emptyState__icon">⚠️</div>
        <div class="emptyState__title">დროებით მიუწვდომელია</div>
        <div class="emptyState__sub">მოსვლის დროების სერვისთან დაკავშირება ვერ მოხერხდა — სცადეთ მოგვიანებით</div>
      </div>`;
    return;
  }

  // route chip-ის არჩევით (highlightedRoute) მხოლოდ იმ მარშრუტის
  // მოსვლის დროები გამოჩნდეს — ისევე, როგორც რუკაზე მხოლოდ ის ხაზი
  // ინათება. "ყველა" ჩვენებაზე დასაბრუნებლად იმავე chip-ზე ხელახლა
  // დაწკაპუნებაა საჭირო (იხ. sheetRouteChips-ის click listener).
  const arrivals = highlightedRoute
    ? (allArrivals || []).filter((a) => a.route === highlightedRoute)
    : allArrivals;

  if (!arrivals || arrivals.length === 0) {
    if (highlightedRoute && allArrivals && allArrivals.length > 0) {
      // საერთოდ არის მოსვლის დროები ამ გაჩერებაზე, უბრალოდ არჩეულ
      // მარშრუტზე არაფერია ახლოს — ეს განსხვავებული შემთხვევაა "საერთოდ
      // მონაცემი არ არის"-ისგან
      arrivalsList.innerHTML = `
        <div class="emptyState">
          <div class="emptyState__icon">🚌</div>
          <div class="emptyState__title">მარშრუტი ${escapeHtml(highlightedRoute)} ახლოს არ არის</div>
          <div class="emptyState__sub">სცადეთ "ყველა მარშრუტის" ნახვა — დააჭირეთ ხელახლა არჩეულ ნომერს</div>
        </div>`;
      return;
    }
    if (!isWithinServiceHours()) {
      const hours = SERVICE_HOURS[CURRENT_CITY] || SERVICE_HOURS.tbilisi;
      const fmt = (h, m) => `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      arrivalsList.innerHTML = `
        <div class="emptyState">
          <div class="emptyState__icon">🌙</div>
          <div class="emptyState__title">ავტობუსები ამჟამად არ დადის</div>
          <div class="emptyState__sub">სამუშაო საათებია ${fmt(hours.startHour, hours.startMinute)}–${fmt(hours.endHour, hours.endMinute)}</div>
        </div>`;
      return;
    }
    arrivalsList.innerHTML = `
      <div class="emptyState">
        <div class="emptyState__icon">🚏</div>
        <div class="emptyState__title">მონაცემი ვერ მოიძებნა</div>
        <div class="emptyState__sub">ამ გაჩერებისთვის მოსვლის დროები ჯერ არ არის ხელმისაწვდომი</div>
      </div>`;
    return;
  }
  arrivalsList.innerHTML = arrivals
    .map((a) => {
      const isMinibus = (stop.routesMinibus || []).includes(a.route);
      const chipClass = isMinibus ? "routeChip--minibus" : "routeChip--bus";
      const realtimeBadge = a.isRealtime
        ? `<span class="arrivalItem__realtime" title="რეალური დრო">●</span>`
        : `<span class="arrivalItem__scheduled" title="განრიგით">○</span>`;
      return `
      <div class="arrivalItem">
        <span class="routeChip ${chipClass}">${escapeHtml(a.route)}</span>
        <span class="arrivalItem__direction">${escapeHtml(a.direction || "—")}</span>
        <span class="arrivalItem__time">${realtimeBadge}${formatEta(a.etaMs)}</span>
      </div>`;
    })
    .join("");
}

/* კომპაქტური (peek) მდგომარეობის მოკლე პრევიუ — mobile-ზე ჩანს
   swipe-up-მდე. ცალკე, უფრო მოკლე markup-ია (routeChip-ის სრული
   სტილის გარეშე), 1-2 უახლოესი მოსვლა + "კიდევ N" მინიშნება, თუ
   მეტია. ცარიელი/loading/error მდგომარეობებში მოკლედ ვაჩვენებთ
   იმავე ტექსტს, რაც სრულ სიაშია, ილუსტრაციების გარეშე. */
function renderArrivalsCompact(result, stop) {
  if (!arrivalsCompact) return;
  const { arrivals: allArrivals, failed } = result;

  if (failed) {
    arrivalsCompact.innerHTML = `<div class="arrivalsCompact__item">⚠️ დროებით მიუწვდომელია</div>`;
    return;
  }

  // renderArrivalsList-ის იგივე route-ფილტრაცია, კომპაქტურ პრევიუშიც
  const arrivals = highlightedRoute
    ? (allArrivals || []).filter((a) => a.route === highlightedRoute)
    : allArrivals;

  if (!arrivals || arrivals.length === 0) {
    if (highlightedRoute && allArrivals && allArrivals.length > 0) {
      arrivalsCompact.innerHTML = `<div class="arrivalsCompact__item">🚌 მარშრუტი ${escapeHtml(highlightedRoute)} ახლოს არ არის</div>`;
      return;
    }
    if (!isWithinServiceHours()) {
      arrivalsCompact.innerHTML = `<div class="arrivalsCompact__item">🌙 ავტობუსები ამჟამად არ დადის</div>`;
      return;
    }
    arrivalsCompact.innerHTML = `<div class="arrivalsCompact__item">🚏 მოსვლის დროები ჯერ არ არის</div>`;
    return;
  }

  const shown = arrivals.slice(0, 2);
  const extraCount = arrivals.length - shown.length;

  arrivalsCompact.innerHTML =
    shown
      .map((a) => {
        const isMinibus = (stop.routesMinibus || []).includes(a.route);
        const chipClass = isMinibus ? "routeChip--minibus" : "routeChip--bus";
        return `
        <div class="arrivalsCompact__item">
          <span class="arrivalsCompact__route ${chipClass}">${escapeHtml(a.route)}</span>
          <span class="arrivalsCompact__direction">${escapeHtml(a.direction || "—")}</span>
          <span class="arrivalsCompact__time">${formatEta(a.etaMs)}</span>
        </div>`;
      })
      .join("") +
    (extraCount > 0
      ? `<div class="arrivalsCompact__more">კიდევ ${extraCount} მარშრუტი ▲</div>`
      : "");
}

// ბოლოს ჩატვირთული arrivals-შედეგი (ინახება route chip-ის
// ფილტრაციისთვის — chip-ზე დაწკაპუნებისას ხელახლა API-ს ვერ
// ვიძახებთ, უბრალოდ იმავე მონაცემს ვფილტრავთ და ვახდენთ re-render-ს)
let lastArrivalsResult = null;
let lastArrivalsStop = null;

async function loadArrivalsForStop(stopId, stop) {
  arrivalsList.innerHTML = `
    <div class="emptyState">
      <div class="emptyState__icon">⏳</div>
      <div class="emptyState__title">იტვირთება...</div>
    </div>`;
  if (arrivalsCompact) {
    arrivalsCompact.innerHTML = `<div class="arrivalsCompact__item">⏳ იტვირთება...</div>`;
  }
  const result = await fetchArrivals(stop.ids && stop.ids.length ? stop.ids : [stop.id]);
  if (activeStopId !== stopId) return;
  lastArrivalsResult = result;
  lastArrivalsStop = stop;
  renderArrivalsList(result, stop);
  renderArrivalsCompact(result, stop);
}

function renderSheetInfo(stopId) {
  const stop = STOPS_BY_ID[stopId];
  const report = getReport(stopId);
  sheetStopName.textContent = stop.name;
  renderStatusBanner(report);
  renderRouteChips(stop);
}

/* გაჩერების მონიშვნა (მარკერზე ring) რჩება მანამ, სანამ სხვა
   გაჩერებას არ ავირჩევთ — sheet-ის დახურვა ("ჩაკეცვა") ამას არ
   შლის, მხოლოდ პანელს მალავს. */
function showPeek(stopId) {
  const stop = STOPS_BY_ID[stopId];
  if (!stop) return;
  sheetPeekName.textContent = stop.name;
  sheetPeek.classList.remove("hidden");
  document.body.classList.add("has-sheet-peek");
}

function hidePeek() {
  sheetPeek.classList.add("hidden");
  document.body.classList.remove("has-sheet-peek");
}

function openSheet(stopId) {
  const stop = STOPS_BY_ID[stopId];
  if (!stop) return;
  activeStopId = stopId;
  if (stopId !== selectedStopId) {
    selectStop(stopId);
  }
  hidePeek();
  renderSheetInfo(stopId);
  overlay.classList.remove("hidden");
  sheet.classList.remove("hidden");
  // ყოველი ახალი გახსნა კომპაქტურ (peek) მდგომარეობით იწყება mobile-ზე —
  // მომხმარებელი თავად swipe-up-ით ან handle-ზე tap-ით გაშლის
  sheet.classList.remove("sheet--expanded");
  sheet.style.transform = "";
  // Desktop-ზე ბოლოს შენახული (გადათრეული) პოზიცია აღვადგინოთ — sheet
  // ახლა ხილვადია, ასე რომ getBoundingClientRect() სწორ ზომებს დააბრუნებს
  restoreSheetPosition();
  // Mobile-ზეც კომპაქტურ (peek) მდგომარეობაში 1-2 უახლოესი მოსვლის
  // დროის პრევიუ ჩანს (.arrivalsCompact), ამიტომ ჩატვირთვა ყოველთვის
  // საჭიროა — არა მხოლოდ expandSheet()-ის დროს.
  loadArrivalsForStop(stopId, stop);
}

/* "ჩაკეცვა" — sheet იმალება, მაგრამ პატარა ზოლი გაჩერების სახელით
   და ამოსაწევი ისრით რჩება ეკრანის ბოლოში. მასზე დაჭერით isev
   იხსნება სრული პანელი. მონიშვნა და ხაზები რუკაზე ხელუხლებელია. */
function closeSheet() {
  overlay.classList.add("hidden");
  sheet.classList.add("hidden");
  sheet.classList.remove("sheet--expanded");
  sheet.style.transform = "";
  activeStopId = null;
  if (selectedStopId) showPeek(selectedStopId);
}

sheetPeekMain.addEventListener("click", () => {
  if (selectedStopId) openSheet(selectedStopId);
});

sheetPeekDeselect.addEventListener("click", () => {
  deselectStop();
});

function setActionButtonsDisabled(disabled) {
  btnInspector.disabled = disabled;
  btnClear.disabled = disabled;
}

const REPORT_RADIUS_M = 1000; // 1 კმ

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function handleReportClick(status, successMsg) {
  if (!activeStopId) return;
  if (isNightTime()) {
    showToast("ღამის 00:00 – 07:00 შეტყობინება შეუძლებელია");
    return;
  }
  const stopId = activeStopId;
  const stop = STOPS_BY_ID[stopId];
  setActionButtonsDisabled(true);

  /* ლოკაციის შემოწმება */
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 })
    );
    const dist = haversineDistance(pos.coords.latitude, pos.coords.longitude, stop.lat, stop.lng);
    if (dist > REPORT_RADIUS_M) {
      showToast(`შენ ამ გაჩერებიდან ${Math.round(dist)}მ-ში ხარ — მხოლოდ 1კმ რადიუსში შეიძლება მონიშვნა`);
      setActionButtonsDisabled(false);
      return;
    }
  } catch {
    showToast("ლოკაციის წვდომა საჭიროა მონიშვნისთვის 📍");
    setActionButtonsDisabled(false);
    return;
  }

  try {
    const { scored } = await setReport(stopId, status, stop ? stop.name : "");
    refreshMarker(stopId);
    closeSheet();

    recordMyContribToday(stopId);
    const contrib = incrementContribution();
    renderContribSection();
    renderCommunitySection();
    refreshLeaderboardWidgetIfOpen();

    if (contrib.leveledUp) {
      showToast(`🎉 ახალი დონე: ${contrib.tier.emoji} ${contrib.tier.label}!`);
    } else if (scored) {
      showToast("🏆 +1 ქულა — შენ იყავი პირველი, ვინც ეს გაჩერება მონიშნა!");
      maybePromptNickname();
    } else {
      showToast(successMsg);
    }
  } catch (err) {
    showToast("შეცდომა — სცადე ისევ 🙁");
  } finally {
    setActionButtonsDisabled(false);
  }
}

btnInspector.addEventListener("click", () => {
  vibrate(40);
  handleReportClick("inspector", "მადლობა! კონტროლიორი მონიშნულია");
});

btnClear.addEventListener("click", () => {
  vibrate(30);
  handleReportClick("clear", "მადლობა! თავისუფალი მონიშნულია");
});

sheetClose.addEventListener("click", () => { vibrate(20); closeSheet(); });
overlay.addEventListener("click", closeSheet);

/* ============================================================
   Swipe up/down + handle-tap — bottom sheet-ის კომპაქტური/სრული
   მდგომარეობებს შორის გადართვისთვის (მხოლოდ mobile ეკრანებზე,
   იხ. .sheet--expanded კლასის CSS წესები @media (max-width:767px)).
   ------------------------------------------------------------
   GPU-accelerated: transform: translateY() + opacity.
   თითის მოძრაობა სინქრონულია, ყოველგვარი lag-ის გარეშე.

   ლოგიკა:
   - ჩაკეცილი (კომპაქტური) მდგომარეობაში ზემოთ swipe → იშლება
     (.sheet--expanded emატება)
   - გაშლილ მდგომარეობაში ქვემოთ swipe → იკეცება (.sheet--expanded
     იხსნება), კიდევ უფრო ქვემოთ swipe (ან სწრაფი flick) → იხურება
     მთლიანად
   - handle-ზე უბრალო tap (drag-ის გარეშე) → toggle expand/collapse
   ============================================================ */
function isMobileSheetLayout() {
  return window.matchMedia("(max-width: 767px)").matches;
}

(function initSwipeSheet() {
  let startY = 0;
  let isDragging = false;
  let movedEnough = false; // განასხვავებს swipe-ს ჩვეულებრივი tap-ისგან

  sheet.addEventListener("touchstart", (e) => {
    if (e.target.closest("button, .routeChip, a, input")) return;
    // მხოლოდ მაშინ გავააქტიუროთ, თუ scroll არის top-ზე (გაშლილ
    // მდგომარეობაში sheet შიგნით scroll-დება)
    if (sheet.scrollTop > 5) return;
    startY = e.touches[0].clientY;
    isDragging = true;
    movedEnough = false;
    sheet.style.transition = "none";
  }, { passive: true });

  sheet.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > 6) movedEnough = true;

    const expanded = sheet.classList.contains("sheet--expanded");

    if (!isMobileSheetLayout()) {
      // Desktop/tablet: მხოლოდ ძველი ქცევა — ქვემოთ swipe = დახურვა
      if (dy < 0) { isDragging = false; sheet.style.transition = ""; sheet.style.transform = ""; return; }
      e.preventDefault();
      sheet.style.transform = `translateY(${dy}px)`;
      overlay.style.opacity = 1 - Math.min(1, dy / 250);
      return;
    }

    if (!expanded && dy < 0) {
      // კომპაქტურ მდგომარეობაში ზემოთ swipe — ვცემთ ვიზუალურ feedback-ს,
      // მაგრამ ნამდვილი expand ჟესტის დასრულებისას ხდება (touchend)
      e.preventDefault();
      const progress = Math.min(1, -dy / 120);
      sheet.style.transform = `translateY(${-progress * 6}px)`; // მცირე "აწევის" მინიშნება
      return;
    }

    if (expanded && dy > 0) {
      // გაშლილ მდგომარეობაში ქვემოთ swipe — თანდათან იკეცება/იხურება
      e.preventDefault();
      sheet.style.transform = `translateY(${dy}px)`;
      overlay.style.opacity = 1 - Math.min(1, dy / 350);
      return;
    }

    // საწინააღმდეგო მიმართულება (already expanded + swipe up, ან
    // collapsed + swipe down) — არაფერს ვაკეთებთ, ბუნებრივ scroll-საც
    // ხელს არ ვუშლით
    isDragging = false;
    sheet.style.transition = "";
    sheet.style.transform = "";
  }, { passive: false });

  sheet.addEventListener("touchend", (e) => {
    if (!isDragging) return;
    isDragging = false;
    sheet.style.transition = "";
    sheet.style.transform = "";
    overlay.style.opacity = "";

    const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : startY;
    const dy = endY - startY; // დადებითი = ქვემოთ, უარყოფითი = ზემოთ

    if (!isMobileSheetLayout()) {
      if (dy > 80) closeSheet();
      return;
    }

    const expanded = sheet.classList.contains("sheet--expanded");

    if (!movedEnough) {
      // ეს იყო ჩვეულებრივი tap, არა swipe — handle-ის დაწკაპუნების
      // toggle-ს (ქვემოთ, ცალკე listener-ში) მივანდოთ
      return;
    }

    if (!expanded && dy < -40) {
      expandSheet();
    } else if (expanded && dy > 130) {
      closeSheet();
    } else if (expanded && dy > 40) {
      collapseSheet();
    }
  });

  // handle-ზე მარტივი tap (swipe-ის გარეშე) — toggle
  sheet.querySelector(".sheet__handle").addEventListener("click", () => {
    if (!isMobileSheetLayout()) return;
    if (sheet.classList.contains("sheet--expanded")) {
      collapseSheet();
    } else {
      expandSheet();
    }
  });

  // კომპაქტური arrivals-პრევიუც ღილაკივით მოქმედებს — მასზე tap-ი
  // ასევე შლის sheet-ს (ცალკე ვიზუალური მინიშნებაა "▲ კიდევ N
  // მარშრუტი", რომ ცხადია, ეს ინტერაქტიულია)
  if (arrivalsCompact) {
    arrivalsCompact.addEventListener("click", () => {
      if (!isMobileSheetLayout()) return;
      expandSheet();
    });
  }
})();

function expandSheet() {
  sheet.classList.add("sheet--expanded");
  // openSheet()-მა უკვე დატვირთა arrivals (compact preview-სთვის),
  // ასე რომ აქ ხელახლა fetch საჭირო აღარაა — renderArrivalsList
  // (სრული სია) და renderArrivalsCompact ორივე ერთი და იმავე
  // loadArrivalsForStop-ის call-ში ივსება.
}
function collapseSheet() {
  sheet.classList.remove("sheet--expanded");
}

/* ============================================================
   Desktop: სრული გადათრევა (drag-and-drop) sheet__handle-ით
   ------------------------------------------------------------
   Mouse-ით (pointer events) მუშაობს მხოლოდ desktop/tablet
   ეკრანებზე (>=768px) — mobile-ზე handle-ს swipe-up/down-ის
   ლოგიკა უკვე მართავს ცალკე listener-ებით (initSwipeSheet).
   პოზიცია ინახება localStorage-ში, refresh-ის შემდეგაც დარჩეს.
   ============================================================ */
const SHEET_POS_KEY = "kontrolio_sheet_pos";

function clampSheetPosition(x, y) {
  const rect = sheet.getBoundingClientRect();
  const margin = 8;
  const maxX = window.innerWidth - rect.width - margin;
  const maxY = window.innerHeight - rect.height - margin;
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, maxX)),
    y: Math.min(Math.max(y, margin), Math.max(margin, maxY)),
  };
}

function applySheetPosition(x, y) {
  sheet.classList.add("sheet--dragged");
  sheet.style.setProperty("--sheet-drag-x", `${x}px`);
  sheet.style.setProperty("--sheet-drag-y", `${y}px`);
}

function saveSheetPosition(x, y) {
  try {
    localStorage.setItem(SHEET_POS_KEY, JSON.stringify({ x, y }));
  } catch (_) {
    // localStorage მიუწვდომელია (private mode და ა.შ.) — უბრალოდ არ ვინახავთ
  }
}

function restoreSheetPosition() {
  if (!isMobileSheetLayout()) {
    try {
      const raw = localStorage.getItem(SHEET_POS_KEY);
      if (raw) {
        const { x, y } = JSON.parse(raw);
        if (typeof x === "number" && typeof y === "number") {
          const clamped = clampSheetPosition(x, y);
          applySheetPosition(clamped.x, clamped.y);
        }
      }
    } catch (_) {
      // ცუდი მონაცემი localStorage-ში — უბრალოდ ვტოვებთ ნაგულისხმევ პოზიციას
    }
  }
}

(function initDesktopDrag() {
  const handle = sheet.querySelector(".sheet__handle");
  let isDragging = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let sheetStartX = 0;
  let sheetStartY = 0;
  let moved = false;

  handle.addEventListener("pointerdown", (e) => {
    if (isMobileSheetLayout()) return; // mobile-ზე ამას touch-swipe ლოგიკა უმართავს
    if (e.pointerType === "touch") return; // touch — mobile swipe-ს მივანდოთ
    isDragging = true;
    moved = false;
    const rect = sheet.getBoundingClientRect();
    sheetStartX = rect.left;
    sheetStartY = rect.top;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    handle.setPointerCapture(e.pointerId);
    sheet.classList.add("dragging");
  });

  handle.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    const clamped = clampSheetPosition(sheetStartX + dx, sheetStartY + dy);
    applySheetPosition(clamped.x, clamped.y);
  });

  function endDrag(e) {
    if (!isDragging) return;
    isDragging = false;
    sheet.classList.remove("dragging");
    if (moved) {
      const rect = sheet.getBoundingClientRect();
      saveSheetPosition(rect.left, rect.top);
    }
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  // ეკრანის resize-ისას (მაგ. window-ის ზომის შეცვლა) პოზიცია ისევ
  // ეკრანის ფარგლებში მოთავსდეს
  window.addEventListener("resize", () => {
    if (!sheet.classList.contains("sheet--dragged")) return;
    const rect = sheet.getBoundingClientRect();
    const clamped = clampSheetPosition(rect.left, rect.top);
    applySheetPosition(clamped.x, clamped.y);
  });
})();

// შენიშვნა: restoreSheetPosition() აქ თავიდან აღარ გვიძახია — sheet
// გვერდის ჩატვირთვისას .hidden მდგომარეობაშია (0×0 ზომით), ასე რომ
// clampSheetPosition-ს სწორი გაზომვები არ ექნებოდა. openSheet()-ში
// გამოძახება საკმარისია, რადგან იქ sheet უკვე ხილვადია.

/* ---------- Night mode (00:00 – 07:00) ---------- */
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

const nightOverlay = document.getElementById("nightOverlay");
const nightClose   = document.getElementById("nightClose");

nightClose.addEventListener("click", () => {
  nightOverlay.classList.add("hidden");
});

function checkNightMode() {
  if (isNightTime()) {
    nightOverlay.classList.remove("hidden");
  }
}

/* ---------- Menu ---------- */
const menuBtn = document.getElementById("menuBtn");
const menuOverlay = document.getElementById("menuOverlay");
const menuDrawer = document.getElementById("menuDrawer");
const menuClose = document.getElementById("menuClose");

function openMenu() {
  menuOverlay.classList.remove("hidden");
  menuDrawer.classList.remove("hidden");
}
function closeMenu() {
  menuOverlay.classList.add("hidden");
  menuDrawer.classList.add("hidden");
}
menuBtn.addEventListener("click", openMenu);
menuClose.addEventListener("click", closeMenu);
menuOverlay.addEventListener("click", closeMenu);

/* ---------- ბურგერ მენიუს ჩამოკეცილი სექციები (accordion) ----------
   ერთხელ ერთი სექცია ღიაა — მეორეზე დაჭერისას წინა იკეტება,
   რომ სია გრძელი და გადატვირთული არ იყოს. */
document.querySelectorAll(".menuDrawer__accHeader").forEach((header) => {
  header.addEventListener("click", () => {
    const isOpen = header.getAttribute("aria-expanded") === "true";
    document.querySelectorAll(".menuDrawer__accHeader").forEach((h) => {
      h.setAttribute("aria-expanded", "false");
    });
    header.setAttribute("aria-expanded", isOpen ? "false" : "true");
  });
});

/* ---------- Theme toggle ---------- */
const themeBtn = document.getElementById("themeBtn");
if (themeBtn) {
  themeBtn.addEventListener("click", toggleTheme);
}

/* ---------- Activity toggle (mobile) ---------- */
const activityBtn = document.getElementById("activityBtn");
activityBtn.addEventListener("click", () => {
  activityPanel.classList.toggle("show");
});

/* ---------- Activity feed ---------- */
const activityPanel = document.getElementById("activityPanel");
const activityHeader = document.getElementById("activityHeader");
const activityPeek = document.getElementById("activityPeek");
const activityList = document.getElementById("activityList");

function formatActivityText(entry) {
  const name = escapeHtml(entry.stopName);
  if (entry.status === "inspector") {
    return `${name} გაჩერებაზე კონტროლიორი გამოჩნდა (${clockTime(entry.ts)})`;
  }
  return `${name} გაჩერება თავისუფალია`;
}

function renderActivityList(entries) {
  if (!entries || entries.length === 0) {
    activityList.innerHTML = `<p class="activityEmpty">დღეს ჯერ არავის შეუტყობინებია</p>`;
    activityPeek.textContent = "დღეს ჯერ არავის შეუტყობინებია";
    return;
  }

  activityList.innerHTML = entries
    .map((entry) => {
      const dotClass = entry.status === "inspector" ? "activityItem__dot--inspector" : "activityItem__dot--clear";
      return `
        <div class="activityItem">
          <span class="activityItem__dot ${dotClass}"></span>
          <div class="activityItem__body">
            <div class="activityItem__text">${formatActivityText(entry)}</div>
            <div class="activityItem__time">${timeAgo(entry.ts)}</div>
          </div>
        </div>`;
    })
    .join("");

  activityPeek.textContent = `${formatActivityText(entries[0])} · ${timeAgo(entries[0].ts)}`;
}

async function loadAndRenderActivity() {
  const entries = await fetchActivity();
  if (entries) renderActivityList(entries);
}

activityHeader.addEventListener("click", () => {
  if (window.innerWidth < 768) {
    activityPanel.classList.toggle("show");
  }
});

/* რუკაზე კლიკით და touch-ით activity panel-ის დახურვა */
map.getContainer().addEventListener("click", () => {
  activityPanel.classList.remove("show");
});

(function () {
  let touchStartY = 0;
  map.getContainer().addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  map.getContainer().addEventListener("touchend", (e) => {
    if (!activityPanel.classList.contains("show")) return;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > -30) activityPanel.classList.remove("show");
  }, { passive: true });
})();

loadAndRenderActivity();
setInterval(loadAndRenderActivity, 10 * 1000);

/* ============================================================
   წვლილის ქულა / ბეჯები
   ------------------------------------------------------------
   განზრახ ფულადი/ნივთიერი ჯილდო არ არის — ეს ხელს შეუწყობდა
   spam-შეტყობინებებს ცრუ ინფორმაციით. ნაცვლად ამისა, ლოკალურ
   (device-ზე, localStorage) მიღწევებს ვითვლით — სუფთა
   რეპუტაციული მოტივაცია, ანონიმურობის დარღვევის გარეშე.
   ============================================================ */
const CONTRIB_KEY = "kontrolio-contrib-count";

const CONTRIB_TIERS = [
  { min: 0,   icon: "sprout",     label: "ახალბედა" },
  { min: 5,   icon: "search",      label: "დამკვირვებელი" },
  { min: 15,  icon: "compass",     label: "მეგზური" },
  { min: 30,  icon: "star",        label: "გამოცდილი" },
  { min: 60,  icon: "award",       label: "ექსპერტი" },
  { min: 100, icon: "crown",       label: "ლეგენდა" },
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

function incrementContribution() {
  const oldCount = getContribCount();
  const newCount = oldCount + 1;
  localStorage.setItem(CONTRIB_KEY, String(newCount));
  const oldTier = tierIndexFor(oldCount);
  const newTier = tierIndexFor(newCount);
  return { count: newCount, leveledUp: newTier > oldTier, tier: CONTRIB_TIERS[newTier] };
}

function renderContribSection() {
  const iconEl = document.getElementById("contribIcon");
  const emojiEl = document.getElementById("contribEmoji"); // fallback
  const tierEl = document.getElementById("contribTier");
  const countEl = document.getElementById("contribCount");
  const barEl = document.getElementById("contribProgressBar");
  const nextEl = document.getElementById("contribNext");
  const todayEl = document.getElementById("contribToday");
  if (!iconEl && !emojiEl) return;

  const count = getContribCount();
  const idx = tierIndexFor(count);
  const tier = CONTRIB_TIERS[idx];
  const next = CONTRIB_TIERS[idx + 1];

  if (iconEl) {
    iconEl.setAttribute("data-lucide", tier.icon);
    if (window.lucide) lucide.createIcons();
  } else if (emojiEl) {
    emojiEl.textContent = tier.emoji || "🌱";
  }
  tierEl.textContent = tier.label;
  countEl.textContent = count === 0
    ? "ჯერ არ გაგიგზავნია შეტყობინება"
    : `${count} შეტყობინება გაგზავნილი`;

  if (next) {
    const span = next.min - tier.min;
    const progressed = count - tier.min;
    barEl.style.width = `${Math.min(100, Math.round((progressed / span) * 100))}%`;
    nextEl.textContent = `${next.min - count} შეტყობინება დარჩა შემდეგ დონემდე: ${next.label}`;
  } else {
    barEl.style.width = "100%";
    nextEl.textContent = "მიაღწიე ყველაზე მაღალ დონეს — მადლობა წვლილისთვის!";
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

/* ---------- "დღეს დაეხმარე X ადამიანს" — პირადი (device-ზე) ტრეკინგი ----------
   ინახავს, რომელ გაჩერებებზე შენ თვითონ შეატყობინე დღეს. ეს არასდროს
   იგზავნება სერვერზე პირადობასთან დაკავშირებული სახით — მხოლოდ
   localStorage-შია, ერთი დღით (Tbilisi calendar day). "დახმარებულების"
   რიცხვი მიახლოებითია: რამდენმა სხვა სესიამ ნახა ეს კონკრეტული სტატუსი,
   სანამ ის აქტიური იყო. */
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

function recordMyContribToday(stopId) {
  const data = getMyContribToday();
  if (!data.stopIds.includes(stopId)) data.stopIds.push(stopId);
  data.reportCount = (data.reportCount || 0) + 1;
  try {
    localStorage.setItem(MY_CONTRIB_TODAY_KEY, JSON.stringify(data));
  } catch (_) {}
  return data;
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

/* ---------- საზოგადოების დღევანდელი აქტივობა (menu drawer) ----------
   citywide ჯამი გამოთვლილია client-ზე, reportsToday ველიდან, რომელიც
   უკვე მოდის GET /api/reports-ის ყოველი აქტიური გაჩერებისთვის. */
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
   ლიდერბორდი (menu drawer-ში)
   ------------------------------------------------------------
   ანონიმური, მუდმივი ტოპ-10 + "შენი" პოზიცია (ტოპში იქნება
   თუ არა). Nickname-ს მომხმარებელი პირველი ქულის მიღებისას
   ირჩევს — ეს არავითარ ვალდებულებას არ წარმოადგენს, უბრალოდ
   ტოპ სიაში საკუთარი თავის ამოცნობის საშუალებაა. */
const NICKNAME_ASKED_KEY = "kontrolio-nickname-asked";
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

function refreshLeaderboardWidgetIfOpen() {
  /* ლიდერბორდის სექცია აღარ არსებობს მთავარ გვერდზე — ცალკე
     leaderboard.html-ზეა. ეს ფუნქცია მხოლოდ იმ ID-ებს ეხმარება,
     რომლებიც ჯერ კიდევ სხვა კონტექსტიდან შეიძლება გამოძახებულ იქნეს. */
  const listEl = document.getElementById("leaderboardList");
  if (listEl) renderLeaderboardSection();
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
  localStorage.setItem(NICKNAME_ASKED_KEY, "true");
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
      showToast("მეტსახელი შენახულია 🎉");
      refreshLeaderboardWidgetIfOpen();
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

/* პირველი ქულის მიღებისას ვთხოვთ მეტსახელს (ერთხელ, თუ უკვე არ
   შეურჩევია და აქამდე არ გამოგვითხოვია). */
function maybePromptNickname() {
  if (localStorage.getItem(NICKNAME_ASKED_KEY) === "true") return;
  const existing = localStorage.getItem("_kontrolio_has_nickname");
  if (existing === "true") return;
  openNicknamePrompt();
}

/* ---------- Toast ---------- */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

/* ---------- Haptic feedback (ტაქტილური ვიბრაცია) ----------
   მთავარ ღილაკებზე navigator.vibrate-ით ნატიური მობილური
   აპლიკაციის შეგრძნებას ქმნის. */
function vibrate(duration = 50) {
  try {
    if (navigator.vibrate) navigator.vibrate(duration);
  } catch (_) { /* ignore */ }
}

/* ---------- Search (button in topbar, bar drops below) ---------- */
const searchInputWrap = document.getElementById("searchInputWrap");
const searchToggleBtn = document.getElementById("searchToggleBtn");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

if (searchToggleBtn) {
  searchToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (searchInputWrap.classList.contains("expanded")) {
      // Collapse
      searchInputWrap.classList.remove("expanded");
      searchToggleBtn.setAttribute("aria-expanded", "false");
      searchResults.classList.remove("show");
      searchInput.value = "";
      debouncedRenderSearchResults("");
    } else {
      // Expand
      searchInputWrap.classList.add("expanded");
      searchToggleBtn.setAttribute("aria-expanded", "true");
      setTimeout(() => searchInput.focus(), 30);
    }
  });
  searchInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (!searchInput.value.trim() && !document.activeElement?.closest("#searchResults")) {
        searchInputWrap.classList.remove("expanded");
        searchToggleBtn.setAttribute("aria-expanded", "false");
        searchResults.classList.remove("show");
      }
    }, 150);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      debouncedRenderSearchResults("");
      searchInput.blur();
      searchInputWrap.classList.remove("expanded");
      searchToggleBtn.setAttribute("aria-expanded", "false");
      searchResults.classList.remove("show");
    }
  });
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    searchResults.classList.remove("show");
    searchResults.innerHTML = "";
    return;
  }

  const matches = STOPS.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);

  if (matches.length === 0) {
    searchResults.innerHTML = `
      <div class="searchResult searchResult--empty">
        <div class="emptyState">
          <div class="emptyState__icon">🔍</div>
          <div class="emptyState__title">გაჩერება არ მოიძებნა</div>
          <div class="emptyState__sub">სცადეთ სხვა ქუჩის ან გაჩერების სახელის მითითება</div>
        </div>
      </div>`;
  } else {
    searchResults.innerHTML = matches
      .map((s) => {
        const allRoutes = [...(s.routesBus || []), ...(s.routesMinibus || [])];
        const meta = [typeLabel(s.types), allRoutes.length ? allRoutes.join(", ") : null]
          .filter(Boolean)
          .join(" · ");
        return `<div class="searchResult" data-id="${s.id}">${escapeHtml(s.name)}<small>${escapeHtml(meta)}</small></div>`;
      })
      .join("");
  }
  searchResults.classList.add("show");
}

function goToStop(stopId) {
  const stop = STOPS_BY_ID[stopId];
  const marker = markers[stopId];
  if (!stop || !marker) return;

  searchResults.classList.remove("show");
  searchInput.value = stop.name;
  searchInput.blur();

  if (clusterGroup.zoomToShowLayer) {
    clusterGroup.zoomToShowLayer(marker, () => openSheet(stopId));
  } else {
    map.setView([stop.lat, stop.lng], 18);
    openSheet(stopId);
  }
}

const debouncedRenderSearchResults = debounce(renderSearchResults, 250);
searchInput.addEventListener("input", (e) => debouncedRenderSearchResults(e.target.value));
searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim()) renderSearchResults(searchInput.value);
});

searchResults.addEventListener("click", (e) => {
  const item = e.target.closest(".searchResult[data-id]");
  if (!item) return;
  goToStop(item.dataset.id);
});

document.addEventListener("click", (e) => {
  // Collapse search input on outside click if empty
  if (searchToggleBtn && searchInputWrap && searchInputWrap.classList.contains("expanded")) {
    if (!e.target.closest("#searchInputWrap") && !e.target.closest("#searchToggleBtn") && !searchInput.value.trim()) {
      searchInputWrap.classList.remove("expanded");
      searchToggleBtn.setAttribute("aria-expanded", "false");
      searchResults.classList.remove("show");
    }
  }
  // Close search results on outside click
  if (!e.target.closest("#searchInputWrap") && !e.target.closest("#searchToggleBtn")) {
    searchResults.classList.remove("show");
  }
});

/* ---------- პერიოდული სინქრონიზაცია სერვერთან ---------- */
async function pollAndRender() {
  const ok = await refreshReportsFromServer();
  if (ok) {
    renderAllMarkers();
    if (activeStopId) renderSheetInfo(activeStopId);
    renderCommunitySection();
    renderContribSection();
  }
}

setInterval(pollAndRender, 15 * 1000);

/* ---------- ონლაინ მომხმარებლების badge ----------
   (გადმოტანილი index.html-ის ინლაინ <script>-დან — CSP-ში script-src
   'unsafe-inline'-ს განზრახ არ ვტოვებთ, ამიტომ ეს გარეშე ფაილში
   უნდა იყოს, რომ არ დაბლოკოს.) */
(function () {
  const countEl = document.getElementById("onlineCount");
  if (!countEl) return;

  async function beat() {
    try {
      const r = await fetch(`${API_BASE}/heartbeat?sid=${encodeURIComponent(getSid())}`);
      if (!r.ok) return;
      const { online } = await r.json();
      countEl.textContent = online;
    } catch (_) {}
  }

  beat();
  setInterval(beat, 20 * 1000);
})();

/* ---------- გაშვება ---------- */
(async function init() {
  checkNightMode();
  await refreshReportsFromServer();
  renderAllMarkers();
  renderContribSection();
  renderCommunitySection();

  const initialTheme = getSavedTheme();
  setTheme(initialTheme);

  /* წინა ვიზიტის ლოკაცია მაშინვე ვაჩვენოთ, შემდეგ ცოცხალი
     პოზიციით ჩუმად განვაახლოთ თუ ბრაუზერი დართავს */
  restoreSavedUserLocation();
  tryAutoUpdateUserLocation();

  lucide.createIcons();

  /* თუ ავტო-რეჟიმში ვართ, ყოველ წუთში ერთხელ ვამოწმებთ დროს */
  setInterval(() => {
    if (localStorage.getItem(THEME_MANUAL_KEY) !== "true") {
      const sys = getSystemTheme();
      const current = document.documentElement.getAttribute("data-theme") || "light";
      if (sys !== current) setTheme(sys);
    }
  }, 60 * 1000);
})();

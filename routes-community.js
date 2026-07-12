/* ============================================================
   routes-community.js — საზოგადოების მარშრუტების გვერდი
   ------------------------------------------------------------
   ორი რეჟიმი:
   1. სია (default) — დამტკიცებული custom routes, click → გაფართოებული preview
   2. დახატვა (Add ღილაკით) — Leaflet-ზე click-to-draw, stop-picker
      modal-ით point-ებზე გაჩერების მისაბმელად (არსებული ან ახალი),
      ფორმა, submit → POST /api/custom-routes (moderation queue-ში)

   + Admin delete (X-Admin-Password header-ით)
   + Dark theme sync მთავარი გვერდის localStorage-პრეფერენციასთან
   ============================================================ */

const API_BASE = "/api";

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
    timeZone: "Asia/Tbilisi", hour: "2-digit", hour12: false,
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
setTheme(getSavedTheme());

/* ---------- Toast ---------- */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

/* ---------- ტრანსპორტის მოდელები (იგივე სია, რაც backend-ში) ---------- */
const VEHICLE_MODELS = {
  bus: [
    { id: "man18c", label: "MAN Lion's City 18C (CNG, გარმონი)" },
    { id: "man12", label: "MAN Lion's City 12მ (CNG)" },
    { id: "bmc12", label: "BMC Procity 12მ (CNG)" },
    { id: "man10", label: "MAN 10მ (ლურჯი)" },
    { id: "isuzu8", label: "Isuzu Novociti Life 8მ" },
  ],
  minibus: [{ id: "fordtransit", label: "Ford Transit (ლურჯი)" }],
};
const VEHICLE_LABEL_LOOKUP = {};
Object.entries(VEHICLE_MODELS).forEach(([type, models]) => {
  models.forEach((m) => (VEHICLE_LABEL_LOOKUP[m.id] = m.label));
});

/* ============================================================
   რეჟიმის გადართვა: სია ⇄ დახატვა
   ============================================================ */
const rcPage = document.getElementById("rcPage");
const listBody = document.getElementById("rcListBody");
const drawWrap = document.getElementById("rcDrawWrap");
const addBtn = document.getElementById("rcAddBtn");
const backBtn = document.getElementById("rcBackBtn");
const headerTitle = document.getElementById("rcHeaderTitle");
const submitBar = document.getElementById("rcSubmitBar");

let mode = "list"; // "list" | "draw" | "detail"
let map = null;

function enterDrawMode() {
  mode = "draw";
  listBody.style.display = "none";
  rcPage.classList.remove("wide-list");
  drawWrap.classList.add("active");
  submitBar.classList.add("active");
  addBtn.style.display = "none";
  headerTitle.textContent = "ახალი მარშრუტი";
  backBtn.removeAttribute("href");
  backBtn.addEventListener("click", exitDrawModeConfirm);

  if (!map) initDrawMap();
  else setTimeout(() => map.invalidateSize(), 50);
}

function exitDrawModeConfirm(e) {
  e.preventDefault();
  if (drawPoints.length > 0) {
    if (!confirm("დახატული ხაზი დაიკარგება — გსურს გამოსვლა?")) return;
  }
  exitDrawMode();
}

function exitDrawMode() {
  mode = "list";
  listBody.style.display = "";
  rcPage.classList.add("wide-list");
  drawWrap.classList.remove("active");
  submitBar.classList.remove("active");
  addBtn.style.display = "";
  headerTitle.textContent = "საზოგადოების მარშრუტები";
  backBtn.setAttribute("href", "index.html");
  backBtn.removeEventListener("click", exitDrawModeConfirm);
  resetDrawState();
}

addBtn.addEventListener("click", enterDrawMode);
backBtn.addEventListener("click", (e) => {
  if (mode === "draw") exitDrawModeConfirm(e);
  else if (mode === "detail") {
    e.preventDefault();
    exitDetailMode();
  }
});

/* ============================================================
   Draw map — click-to-add-point ხაზის დახატვა
   ------------------------------------------------------------
   ორი რეჟიმი toolbar-ში:
   - "ხაზის დახატვა" (default) — click უბრალოდ ამატებს point-ს ხაზზე
   - "გაჩერების დამატება" (toggle ღილაკით) — click ერთდროულად
     ამატებს point-ს და მაშინვე ხსნის stop-picker-ს, ერთ ნაბიჯად
     (ნაცვლად "point დასვი, მერე ცალკე დააჭირე point-ს" ორნაბიჯიანი
     flow-სი). ეს არის ნაგულისხმევი გზა გაჩერების მისაბმელად.

   ხაზზე უკვე დასმულ point-ს კვლავაც შეგიძლია დააჭირო stop-picker-ის
   ხელახლა გასახსნელად/შესაცვლელად — ამისთვის point-marker-ის
   ჰიტ-არეა გაზრდილია (invisible ფართო circle awtenticity ცალკე
   layer-ად), რომ პატარა touch-target არ იყოს პრობლემა მობილურზე. */
let drawPoints = [];
let drawPolyline = null;
let pointMarkers = []; // ვიზუალური, პატარა წრეები
let pointHitAreas = []; // უხილავი, დიდი — click/touch-ისთვის
let stopLinks = []; // [{ pointIndex, stopId|null, customLabel|null, _label }]
let addStopMode = false; // toggle: შემდეგი click ერთდროულად ამატებს point-ს + ხსნის picker-ს

function initDrawMap() {
  map = L.map("rcMap", { zoomControl: true }).setView([41.7151, 44.8271], 12.5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  map.on("click", (e) => {
    const idx = addDrawPoint(e.latlng.lat, e.latlng.lng);
    if (addStopMode) {
      openStopPicker(idx);
    }
  });
}

function redrawPolyline() {
  if (drawPolyline) map.removeLayer(drawPolyline);
  if (drawPoints.length >= 2) {
    const options = { color: "#1f6fd6", weight: 5, opacity: 0.85 };
    if (routeShape === "loop" && drawPoints.length >= 3) {
      drawPolyline = L.polygon(drawPoints, { ...options, fill: false }).addTo(map);
    } else {
      drawPolyline = L.polyline(drawPoints, options).addTo(map);
    }
  }
}

function addDrawPoint(lat, lng) {
  const idx = drawPoints.length;
  drawPoints.push([lat, lng]);

  // ვიზუალური, პატარა წრე — ისე გამოიყურება, როგორც აქამდე
  const marker = L.circleMarker([lat, lng], {
    radius: 7, color: "#fff", weight: 2, fillColor: "#1f6fd6", fillOpacity: 1,
    interactive: false, // click-ს ქვემოთა hit-area იჭერს, ორმაგი listener რომ არ დაგვჭირდეს
  }).addTo(map);

  // უხილავი, ბევრად უფრო დიდი hit-area — მობილურზე თითით ზუსტი
  // მიზნის ძებნა აღარ სჭირდება. radius პიქსელებშია (ეკრანის
  // ზომაზეა დამოკიდებული, არა zoom-ზე), ანუ ნებისმიერ zoom-level-ზე
  // თანაბრად კომფორტულია.
  const hitArea = L.circleMarker([lat, lng], {
    radius: 18,
    stroke: false,
    fillOpacity: 0,
    interactive: true,
    bubblingMouseEvents: false,
  }).addTo(map);

  hitArea.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    openStopPicker(idx);
  });

  pointMarkers.push(marker);
  pointHitAreas.push(hitArea);
  redrawPolyline();
  updateDrawHint();
  renderStopLinkList();
  return idx;
}

function undoLastPoint() {
  if (drawPoints.length === 0) return;
  drawPoints.pop();
  const marker = pointMarkers.pop();
  const hitArea = pointHitAreas.pop();
  if (marker) map.removeLayer(marker);
  if (hitArea) map.removeLayer(hitArea);
  stopLinks = stopLinks.filter((s) => s.pointIndex < drawPoints.length);
  redrawPolyline();
  updateDrawHint();
  renderStopLinkList();
}

function clearDrawing() {
  if (drawPoints.length > 0 && !confirm("ნამდვილად გსურს მთელი ხაზის წაშლა?")) return;
  resetDrawState();
}

function resetDrawState() {
  drawPoints = [];
  stopLinks = [];
  pointMarkers.forEach((m) => map && map.removeLayer(m));
  pointHitAreas.forEach((h) => map && map.removeLayer(h));
  pointMarkers = [];
  pointHitAreas = [];
  if (drawPolyline && map) map.removeLayer(drawPolyline);
  drawPolyline = null;
  addStopMode = false;
  updateAddStopModeBtn();
  updateDrawHint();
  renderStopLinkList();
  clearFormFields();
}

function updateDrawHint() {
  const hint = document.getElementById("rcDrawHint");
  if (addStopMode) {
    hint.textContent = drawPoints.length === 0
      ? "დააჭირე რუკას — წერტილიც დაემატება და მაშინვე გაჩერების არჩევასაც შემოგთავაზებ"
      : `${drawPoints.length} წერტილი — გააგრძელე დაჭერა ახალი გაჩერებების დასამატებლად`;
    return;
  }
  if (drawPoints.length === 0) {
    hint.textContent = "დააჭირე რუკას, რომ დაიწყო ხაზის დახატვა";
  } else if (drawPoints.length === 1) {
    hint.textContent = "დააჭირე ისევ, რომ გააგრძელო ხაზი";
  } else {
    hint.textContent = `${drawPoints.length} წერტილი — ისარჩიე "🚏 გაჩერების დამატება" ღილაკი, ან დააჭირე არსებულ წერტილს`;
  }
}

document.getElementById("rcUndoBtn").addEventListener("click", undoLastPoint);
document.getElementById("rcClearBtn").addEventListener("click", clearDrawing);

/* ---------- "გაჩერების დამატება" toggle ---------- */
const addStopModeBtn = document.getElementById("rcAddStopModeBtn");
function updateAddStopModeBtn() {
  addStopModeBtn.classList.toggle("active", addStopMode);
}
addStopModeBtn.addEventListener("click", () => {
  addStopMode = !addStopMode;
  updateAddStopModeBtn();
  updateDrawHint();
});

/* ============================================================
   Stop picker modal — არსებული გაჩერების ძებნა ან ახლის შექმნა
   ============================================================ */
const stopPickerOverlay = document.getElementById("stopPickerOverlay");
const stopPickerSheet = document.getElementById("stopPickerSheet");
const spTabExisting = document.getElementById("spTabExisting");
const spTabNew = document.getElementById("spTabNew");
const spExistingPane = document.getElementById("spExistingPane");
const spNewPane = document.getElementById("spNewPane");
const spSearchInput = document.getElementById("spSearchInput");
const spResults = document.getElementById("spResults");
const spNewNameInput = document.getElementById("spNewNameInput");
const spConfirmBtn = document.getElementById("spConfirmBtn");
const spRemoveBtn = document.getElementById("spRemoveBtn");
const spCancelBtn = document.getElementById("spCancelBtn");

let spActivePointIndex = null;
let spSelectedStop = null; // { stopId, name } | null
let spTab = "existing";

function openStopPicker(pointIndex) {
  spActivePointIndex = pointIndex;
  const existing = stopLinks.find((s) => s.pointIndex === pointIndex);

  spTab = "existing";
  spTabExisting.classList.add("selected");
  spTabNew.classList.remove("selected");
  spExistingPane.style.display = "";
  spNewPane.style.display = "none";
  spSearchInput.value = "";
  spNewNameInput.value = "";
  spSelectedStop = null;
  spResults.innerHTML = "";

  if (existing) {
    if (existing.stopId) {
      spSelectedStop = { stopId: existing.stopId, name: existing._label };
      spSearchInput.value = existing._label;
      renderSearchResults(existing._label);
    } else {
      spTab = "new";
      spTabExisting.classList.remove("selected");
      spTabNew.classList.add("selected");
      spExistingPane.style.display = "none";
      spNewPane.style.display = "";
      spNewNameInput.value = existing.customLabel || "";
    }
  }

  stopPickerOverlay.classList.remove("hidden");
  stopPickerSheet.classList.remove("hidden");
  if (spTab === "existing") spSearchInput.focus();
}

function closeStopPicker() {
  stopPickerOverlay.classList.add("hidden");
  stopPickerSheet.classList.add("hidden");
  spActivePointIndex = null;
}

spTabExisting.addEventListener("click", () => {
  spTab = "existing";
  spTabExisting.classList.add("selected");
  spTabNew.classList.remove("selected");
  spExistingPane.style.display = "";
  spNewPane.style.display = "none";
});
spTabNew.addEventListener("click", () => {
  spTab = "new";
  spTabNew.classList.add("selected");
  spTabExisting.classList.remove("selected");
  spNewPane.style.display = "";
  spExistingPane.style.display = "none";
});

function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q || typeof STOPS === "undefined") {
    spResults.innerHTML = "";
    return;
  }
  const matches = STOPS.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 15);
  if (matches.length === 0) {
    spResults.innerHTML = `<p style="color:var(--grey); font-size:13px; text-align:center; padding:14px 0;">ვერაფერი მოიძებნა</p>`;
    return;
  }
  spResults.innerHTML = matches
    .map((s) => `<div class="stopPickerResult" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>`)
    .join("");
  spResults.querySelectorAll(".stopPickerResult").forEach((el) => {
    el.addEventListener("click", () => {
      spSelectedStop = { stopId: el.dataset.id, name: el.dataset.name };
      spSearchInput.value = el.dataset.name;
      spResults.innerHTML = "";
    });
  });
}

spSearchInput.addEventListener("input", () => {
  spSelectedStop = null;
  renderSearchResults(spSearchInput.value);
});

spConfirmBtn.addEventListener("click", () => {
  if (spActivePointIndex === null) return;

  let entry = null;
  if (spTab === "existing" && spSelectedStop) {
    entry = { pointIndex: spActivePointIndex, stopId: spSelectedStop.stopId, customLabel: null, _label: spSelectedStop.name };
  } else if (spTab === "new" && spNewNameInput.value.trim()) {
    const label = spNewNameInput.value.trim().slice(0, 60);
    entry = { pointIndex: spActivePointIndex, stopId: null, customLabel: label, _label: label };
  } else {
    showToast("აირჩიე გაჩერება ან შეიყვანე სახელი");
    return;
  }

  stopLinks = stopLinks.filter((s) => s.pointIndex !== spActivePointIndex);
  stopLinks.push(entry);
  renderStopLinkList();
  if (pointMarkers[spActivePointIndex]) {
    pointMarkers[spActivePointIndex].setStyle({ fillColor: "#2ec4b6" });
  }
  closeStopPicker();
});

spRemoveBtn.addEventListener("click", () => {
  if (spActivePointIndex === null) return;
  stopLinks = stopLinks.filter((s) => s.pointIndex !== spActivePointIndex);
  renderStopLinkList();
  if (pointMarkers[spActivePointIndex]) {
    pointMarkers[spActivePointIndex].setStyle({ fillColor: "#1f6fd6" });
  }
  closeStopPicker();
});

spCancelBtn.addEventListener("click", closeStopPicker);
stopPickerOverlay.addEventListener("click", closeStopPicker);

function renderStopLinkList() {
  const container = document.getElementById("rcStopLinkList");
  if (stopLinks.length === 0) {
    container.innerHTML = "";
    return;
  }
  const sorted = [...stopLinks].sort((a, b) => a.pointIndex - b.pointIndex);
  container.innerHTML = sorted
    .map(
      (s) => `
      <div class="rcStopLinkItem">
        <span class="rcStopLinkItem__idx">${s.pointIndex + 1}</span>
        <span class="rcStopLinkItem__label">${escapeHtml(s._label || s.customLabel || "?")}</span>
        <button type="button" class="rcStopLinkItem__remove" data-point="${s.pointIndex}"><i data-lucide="x"></i></button>
      </div>`
    )
    .join("");
  container.querySelectorAll(".rcStopLinkItem__remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.point, 10);
      stopLinks = stopLinks.filter((s) => s.pointIndex !== idx);
      renderStopLinkList();
      if (pointMarkers[idx]) pointMarkers[idx].setStyle({ fillColor: "#1f6fd6" });
    });
  });
  if (window.lucide) lucide.createIcons();
}

/* ============================================================
   ფორმა — ტიპი/მოდელი/ნომერი/სახელი/აღწერა
   ============================================================ */
let selectedVehicleType = null;
let routeShape = "oneway"; // "oneway" | "loop"

function populateModelSelect(vehicleType) {
  const select = document.getElementById("rcVehicleModel");
  const models = VEHICLE_MODELS[vehicleType] || [];
  select.innerHTML = models.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
}

function selectVehicleType(type) {
  selectedVehicleType = type;
  document.getElementById("rcVehicleBus").classList.toggle("selected", type === "bus");
  document.getElementById("rcVehicleMinibus").classList.toggle("selected", type === "minibus");
  populateModelSelect(type);
}

document.getElementById("rcVehicleBus").addEventListener("click", () => selectVehicleType("bus"));
document.getElementById("rcVehicleMinibus").addEventListener("click", () => selectVehicleType("minibus"));
selectVehicleType("bus");

function selectRouteShape(shape) {
  routeShape = shape;
  document.getElementById("rcShapeOneway").classList.toggle("selected", shape === "oneway");
  document.getElementById("rcShapeLoop").classList.toggle("selected", shape === "loop");
  redrawPolyline(); // ხაზის ვიზუალიც განახლდეს (polygon vs polyline)
}
document.getElementById("rcShapeOneway").addEventListener("click", () => selectRouteShape("oneway"));
document.getElementById("rcShapeLoop").addEventListener("click", () => selectRouteShape("loop"));
selectRouteShape("oneway");

const routeNumberInput = document.getElementById("rcRouteNumber");
routeNumberInput.addEventListener("input", () => {
  routeNumberInput.value = routeNumberInput.value.replace(/\D/g, "").slice(0, 3);
});

function clearFormFields() {
  routeNumberInput.value = "";
  document.getElementById("rcRouteName").value = "";
  document.getElementById("rcRouteDesc").value = "";
  document.getElementById("rcRouteNumberError").textContent = "";
  document.getElementById("rcRouteNameError").textContent = "";
  document.getElementById("rcFormError").textContent = "";
  selectVehicleType("bus");
  selectRouteShape("oneway");
}

/* ============================================================
   Submit
   ============================================================ */
const NAME_PATTERN = /^[a-zA-Zა-ჰ0-9 .,\-–_/()]{1,80}$/u;
const ROUTE_NUMBER_PATTERN = /^\d{3}$/;

async function submitRoute() {
  const errEl = document.getElementById("rcFormError");
  errEl.textContent = "";

  const routeNumber = routeNumberInput.value.trim();
  const name = document.getElementById("rcRouteName").value.trim();
  const description = document.getElementById("rcRouteDesc").value.trim();
  const vehicleModel = document.getElementById("rcVehicleModel").value;

  if (drawPoints.length < 2) {
    errEl.textContent = "დახატე მინიმუმ 2 წერტილიანი ხაზი რუკაზე";
    return;
  }
  if (routeShape === "loop" && drawPoints.length < 3) {
    errEl.textContent = "წრიულ მარშრუტს მინიმუმ 3 წერტილი სჭირდება";
    return;
  }
  if (!ROUTE_NUMBER_PATTERN.test(routeNumber)) {
    document.getElementById("rcRouteNumberError").textContent = "ზუსტად 3 ციფრი";
    return;
  }
  document.getElementById("rcRouteNumberError").textContent = "";
  if (!NAME_PATTERN.test(name)) {
    document.getElementById("rcRouteNameError").textContent = "1-80 სიმბოლო, ასოები/ციფრები/basic punctuation";
    return;
  }
  document.getElementById("rcRouteNameError").textContent = "";

  const submitBtn = document.getElementById("rcSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "იგზავნება...";

  try {
    const res = await fetch(`${API_BASE}/custom-routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleType: selectedVehicleType,
        vehicleModel,
        routeNumber,
        name,
        description,
        isLoop: routeShape === "loop",
        points: drawPoints,
        stopLinks: stopLinks.map(({ pointIndex, stopId, customLabel }) => ({ pointIndex, stopId, customLabel })),
        sid: getSid(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    showToast("გაგზავნილია! ადმინისტრატორი გადახედავს მალე 🙏");
    exitDrawMode();
    loadRouteList();
  } catch (err) {
    errEl.textContent = err.message || "შეცდომა — სცადე ისევ";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "გაგზავნა განსახილველად";
  }
}

document.getElementById("rcSubmitBtn").addEventListener("click", submitRoute);

/* ============================================================
   სია — დამტკიცებული routes
   ============================================================ */
let currentRoutes = [];

async function loadRouteList() {
  const listEl = document.getElementById("rcList");
  try {
    const res = await fetch(`${API_BASE}/custom-routes`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentRoutes = await res.json();

    if (!Array.isArray(currentRoutes) || currentRoutes.length === 0) {
      listEl.innerHTML = `<p class="rcListEmpty">ჯერ არცერთი მარშრუტი არ არის დამტკიცებული.<br>იყავი პირველი — დახატე შენი! ✏️</p>`;
      return;
    }

    listEl.innerHTML = currentRoutes
      .map((r) => {
        const badgeClass = r.vehicleType === "minibus" ? "rcCard__badge--minibus" : "rcCard__badge--bus";
        const modelLabel = VEHICLE_LABEL_LOOKUP[r.vehicleModel] || r.vehicleModel;
        const stopCount = Array.isArray(r.stopLinks) ? r.stopLinks.length : 0;
        const shapeIcon = r.isLoop ? "🔄" : "";
        return `
        <div class="rcCard" data-id="${escapeHtml(r.id)}">
          <div class="rcCard__top">
            <span class="rcCard__badge ${badgeClass}">${escapeHtml(r.routeNumber)}</span>
            <span class="rcCard__name">${shapeIcon} ${escapeHtml(r.name)}</span>
          </div>
          <span class="rcCard__model">${escapeHtml(modelLabel)}</span>
          ${r.description ? `<p class="rcCard__desc">${escapeHtml(r.description)}</p>` : ""}
          ${stopCount > 0 ? `<span class="rcCard__stopCount">${stopCount} მიბმული გაჩერება</span>` : ""}
        </div>`;
      })
      .join("");

    listEl.querySelectorAll(".rcCard").forEach((card) => {
      card.addEventListener("click", () => {
        const route = currentRoutes.find((r) => r.id === card.dataset.id);
        if (route) enterDetailMode(route);
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="rcListEmpty">ვერ ჩაიტვირთა — სცადე გვერდის განახლება</p>`;
  }
  if (window.lucide) lucide.createIcons();
}

/* ---------- დეტალების preview — სრულმასშტაბიანი, სრულად ინტერაქტიული ----------
   ეს ცალკე "mode"-ია (ისევე, როგორც draw-mode), არა პატარა
   sheet/modal. რუკა სრულ drag/zoom/scroll-ის საშუალებას იძლევა —
   ისევე თავისუფლად შეგიძლია დააკვირდე, როგორც მთავარ გვერდზე. */
const detailWrap = document.getElementById("rcDetailWrap");
const rcDetailDelete = document.getElementById("rcDetailDelete");
let detailMap = null;
let activeDetailRouteId = null;
let activeDetailRoute = null;
let detailResizeObserver = null; // იხ. კომენტარი enterDetailMode-ში

function enterDetailMode(route) {
  mode = "detail";
  activeDetailRouteId = route.id;
  activeDetailRoute = route;

  listBody.style.display = "none";
  rcPage.classList.remove("wide-list");
  detailWrap.classList.add("active");
  addBtn.style.display = "none";
  headerTitle.textContent = `№${route.routeNumber} — ${route.name}`;
  backBtn.removeAttribute("href");

  renderDetailInfo(route);

  // მცირე დაყოვნება — DOM-ს დრო სჭირდება container-ის ზომის დასადგენად
  setTimeout(() => {
    if (detailMap) {
      detailMap.remove();
      detailMap = null;
    }
    detailMap = L.map("rcDetailFullMap", { zoomControl: true }); // სრული drag/zoom/scroll, default-ად ჩართული
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(detailMap);

    const line = route.isLoop
      ? L.polygon(route.points, { color: "#1f6fd6", weight: 5, fill: false }).addTo(detailMap)
      : L.polyline(route.points, { color: "#1f6fd6", weight: 5 }).addTo(detailMap);

    // გაჩერებების მარკერები პირდაპირ რუკაზე — ისევე ცნობადი,
    // როგორც მთავარ გვერდზეა
    (route.stopLinks || []).forEach((link) => {
      const pt = route.points[link.pointIndex];
      if (!pt) return;
      const label = link.stopId && typeof STOPS !== "undefined"
        ? (STOPS.find((st) => st.id === link.stopId)?.name || link.customLabel || "?")
        : (link.customLabel || "?");
      L.circleMarker(pt, {
        radius: 7, color: "#fff", weight: 2, fillColor: "#2ec4b6", fillOpacity: 1,
      })
        .addTo(detailMap)
        .bindTooltip(escapeHtml(label), { direction: "top" });
    });

    detailMap.fitBounds(line.getBounds(), { padding: [30, 30] });

    // rcDetailWrap display:none-დან active-ზე გადართვისას (განსაკუთრებით
    // დესკტოპზე, position:sticky სვეტში) Leaflet ხანდახან container-ის
    // ზომას არასწორად ითვლის შექმნის მომენტში — რუკა ცარიელი/ნაცრისფერი
    // რჩება, სანამ scroll ან სხვა repaint არ აიძულებს ხელახლა გამოთვლას.
    // ვასწორებთ ორნაირად: (1) invalidateSize() მომდევნო paint frame-ის
    // შემდეგ, (2) ResizeObserver container-ზე, რომელიც ნებისმიერ შემდგომ
    // ზომის ცვლილებაზეც (ფონტის ჩატვირთვა, sticky recalculation და ა.შ.)
    // ავტომატურად ასწორებს ზომას — scroll-ის გარეშეც.
    requestAnimationFrame(() => {
      if (detailMap) detailMap.invalidateSize();
    });

    const mapEl = document.getElementById("rcDetailFullMap");
    if (!detailResizeObserver) {
      detailResizeObserver = new ResizeObserver(() => {
        if (detailMap) detailMap.invalidateSize();
      });
    } else {
      detailResizeObserver.disconnect();
    }
    detailResizeObserver.observe(mapEl);
  }, 60);

  if (window.lucide) lucide.createIcons();
}

function renderDetailInfo(route) {
  const badgeClass = route.vehicleType === "minibus" ? "rcCard__badge--minibus" : "rcCard__badge--bus";
  const badgeEl = document.getElementById("rcDetailBadge");
  badgeEl.className = `rcCard__badge ${badgeClass}`;
  badgeEl.textContent = route.routeNumber;

  document.getElementById("rcDetailName").textContent = route.name;

  const modelLabel = VEHICLE_LABEL_LOOKUP[route.vehicleModel] || route.vehicleModel;
  const vehicleIcon = route.vehicleType === "minibus" ? "🚐" : "🚌";
  const shapeLabel = route.isLoop ? "🔄 წრიული" : "↔️ ორმხრივი";
  document.getElementById("rcDetailMeta2").innerHTML = `
    <span>${vehicleIcon} ${escapeHtml(modelLabel)}</span>
    <span>${shapeLabel}</span>
    <span><i data-lucide="map-pin"></i> ${(route.stopLinks || []).length} გაჩერება</span>
  `;

  document.getElementById("rcDetailDesc").textContent = route.description || "";

  const stopsEl = document.getElementById("rcDetailStops");
  const links = (route.stopLinks || []).slice().sort((a, b) => a.pointIndex - b.pointIndex);
  if (links.length > 0) {
    stopsEl.innerHTML =
      `<h4>გაჩერებები</h4>` +
      links
        .map((s, i) => {
          const label = s.stopId && typeof STOPS !== "undefined"
            ? (STOPS.find((st) => st.id === s.stopId)?.name || s.customLabel || "?")
            : (s.customLabel || "?");
          return `
          <div class="rcDetailStopItem">
            <span class="rcDetailStopItem__idx">${i + 1}</span>
            <span>${escapeHtml(label)}</span>
          </div>`;
        })
        .join("");
  } else {
    stopsEl.innerHTML = "";
  }

  rcDetailDelete.classList.toggle("hidden", !isAdminMode());
}

function exitDetailMode() {
  mode = "list";
  listBody.style.display = "";
  rcPage.classList.add("wide-list");
  detailWrap.classList.remove("active");
  addBtn.style.display = "";
  headerTitle.textContent = "საზოგადოების მარშრუტები";
  backBtn.setAttribute("href", "index.html");
  activeDetailRouteId = null;
  activeDetailRoute = null;
  if (detailResizeObserver) detailResizeObserver.disconnect();
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
  }
}

/* ============================================================
   Admin delete
   ------------------------------------------------------------
   პაროლი ერთხელ ჩაიწერება localStorage-ში (prompt-ით), მერე
   ყოველი delete-request-ის header-ში გამოიყენება. თუ 401 დაბრუნდა
   (არასწორია), localStorage-დან იშლება, რომ ხელახლა ითხოვოს.
   ============================================================ */
const ADMIN_PW_KEY = "kontrolio-admin-pw";

function isAdminMode() {
  return !!localStorage.getItem(ADMIN_PW_KEY);
}

function getOrAskAdminPassword() {
  let pw = localStorage.getItem(ADMIN_PW_KEY);
  if (!pw) {
    pw = prompt("Admin პაროლი:");
    if (!pw) return null;
    localStorage.setItem(ADMIN_PW_KEY, pw);
  }
  return pw;
}

rcDetailDelete.addEventListener("click", async () => {
  if (!activeDetailRouteId) return;
  if (!confirm("ნამდვილად გსურს ამ მარშრუტის სამუდამო წაშლა?")) return;

  const pw = getOrAskAdminPassword();
  if (!pw) return;

  try {
    const res = await fetch(`${API_BASE}/custom-routes?id=${encodeURIComponent(activeDetailRouteId)}`, {
      method: "DELETE",
      headers: { "X-Admin-Password": pw },
    });
    if (res.status === 401) {
      localStorage.removeItem(ADMIN_PW_KEY);
      showToast("პაროლი არასწორია");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    showToast("წაშლილია 🗑️");
    exitDetailMode();
    loadRouteList();
  } catch (err) {
    showToast("წაშლა ვერ მოხერხდა");
  }
});

/* გვერდის ჩატვირთვისას, თუ URL-ში ?admin=1 არის, ვთხოვთ პაროლს
   (მარტივი "საიდუმლო ბმულის" მექანიზმი — არ ჩანს ჩვეულებრივ
   მომხმარებელს, თუ URL არ იცის). */
if (new URLSearchParams(location.search).get("admin") === "1" && !isAdminMode()) {
  getOrAskAdminPassword();
}

/* ---------- გაშვება ---------- */
if (window.lucide) lucide.createIcons();
document.getElementById("rcList").classList.add("rcListGrid");
if (window.matchMedia("(min-width: 900px)").matches) {
  rcPage.classList.add("wide-list");
}
loadRouteList();

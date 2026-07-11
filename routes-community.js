/* ============================================================
   routes-community.js — საზოგადოების მარშრუტების გვერდი
   ------------------------------------------------------------
   ორი რეჟიმი:
   1. სია (default) — დამტკიცებული custom routes, click → preview
   2. დახატვა (Add ღილაკით) — Leaflet-ზე click-to-draw, გაჩერების
      მიბმა point-ებზე, ფორმა (ტიპი/მოდელი/ნომერი/სახელი/აღწერა),
      submit → POST /api/custom-routes (moderation queue-ში მიდის)
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

/* ---------- Toast ---------- */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

/* ============================================================
   რეჟიმის გადართვა: სია ⇄ დახატვა
   ============================================================ */
const listBody = document.getElementById("rcListBody");
const drawWrap = document.getElementById("rcDrawWrap");
const addBtn = document.getElementById("rcAddBtn");
const backBtn = document.getElementById("rcBackBtn");
const headerTitle = document.getElementById("rcHeaderTitle");
const submitBar = document.getElementById("rcSubmitBar");

let mode = "list"; // "list" | "draw"
let map = null; // მხოლოდ draw-mode-ში ინიციალიზდება (lazy)

function enterDrawMode() {
  mode = "draw";
  listBody.style.display = "none";
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
});

/* ============================================================
   Draw map — click-to-add-point ხაზის დახატვა
   ============================================================ */
let drawPoints = []; // [[lat,lng], ...]
let drawPolyline = null;
let pointMarkers = []; // L.circleMarker instances
let stopLinks = []; // [{ pointIndex, stopId|null, customLabel|null }]

function initDrawMap() {
  map = L.map("rcMap", { zoomControl: true }).setView([41.7151, 44.8271], 12.5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  map.on("click", (e) => {
    addDrawPoint(e.latlng.lat, e.latlng.lng);
  });
}

function redrawPolyline() {
  if (drawPolyline) map.removeLayer(drawPolyline);
  if (drawPoints.length >= 2) {
    drawPolyline = L.polyline(drawPoints, { color: "#1f6fd6", weight: 5, opacity: 0.85 }).addTo(map);
  }
}

function addDrawPoint(lat, lng) {
  const idx = drawPoints.length;
  drawPoints.push([lat, lng]);

  const marker = L.circleMarker([lat, lng], {
    radius: 7,
    color: "#fff",
    weight: 2,
    fillColor: "#1f6fd6",
    fillOpacity: 1,
  }).addTo(map);

  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e); // point-marker-ზე click არ უნდა დაემატოს ახალი point
    openStopLinkPrompt(idx);
  });

  pointMarkers.push(marker);
  redrawPolyline();
  updateDrawHint();
  renderStopLinkList();
}

function undoLastPoint() {
  if (drawPoints.length === 0) return;
  drawPoints.pop();
  const marker = pointMarkers.pop();
  if (marker) map.removeLayer(marker);
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
  pointMarkers = [];
  if (drawPolyline && map) map.removeLayer(drawPolyline);
  drawPolyline = null;
  updateDrawHint();
  renderStopLinkList();
  clearFormFields();
}

function updateDrawHint() {
  const hint = document.getElementById("rcDrawHint");
  if (drawPoints.length === 0) {
    hint.textContent = "დააჭირე რუკას, რომ დაიწყო ხაზის დახატვა";
  } else if (drawPoints.length === 1) {
    hint.textContent = "დააჭირე ისევ, რომ გააგრძელო ხაზი";
  } else {
    hint.textContent = `${drawPoints.length} წერტილი — დააჭირე ნებისმიერ წერტილს, გაჩერების მისაბმელად`;
  }
}

document.getElementById("rcUndoBtn").addEventListener("click", undoLastPoint);
document.getElementById("rcClearBtn").addEventListener("click", clearDrawing);

/* ---------- გაჩერების მიბმა კონკრეტულ point-ზე ---------- */
function openStopLinkPrompt(pointIndex) {
  const existing = stopLinks.find((s) => s.pointIndex === pointIndex);

  const query = prompt(
    "მოძებნე გაჩერება სახელით (ან დატოვე ცარიელი, რომ ამ წერტილს მხოლოდ ტექსტური ლეიბლი დაერთოს):",
    existing?.customLabel || ""
  );
  if (query === null) return; // Cancel

  if (!query.trim()) {
    stopLinks = stopLinks.filter((s) => s.pointIndex !== pointIndex);
    renderStopLinkList();
    return;
  }

  // მარტივი substring-ძებნა STOPS-ში (stops.js-დან, გლობალურად ხელმისაწვდომია)
  const matches = typeof STOPS !== "undefined"
    ? STOPS.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 1)
    : [];

  const entry = matches.length > 0
    ? { pointIndex, stopId: matches[0].id, customLabel: null, _label: matches[0].name }
    : { pointIndex, stopId: null, customLabel: query.trim().slice(0, 60), _label: query.trim() };

  stopLinks = stopLinks.filter((s) => s.pointIndex !== pointIndex);
  stopLinks.push(entry);
  renderStopLinkList();

  // point-marker-ს ვუცვლით ფერს, რომ ვიზუალურად ჩანდეს "მიბმულია"
  if (pointMarkers[pointIndex]) {
    pointMarkers[pointIndex].setStyle({ fillColor: "#2ec4b6" });
  }
}

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
        <span>${escapeHtml(s._label || s.customLabel || "?")}</span>
      </div>`
    )
    .join("");
}

/* ============================================================
   ფორმა — ტიპი/მოდელი/ნომერი/სახელი/აღწერა
   ============================================================ */
let selectedVehicleType = null;

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
selectVehicleType("bus"); // default

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
const VEHICLE_LABEL_LOOKUP = {};
Object.entries(VEHICLE_MODELS).forEach(([type, models]) => {
  models.forEach((m) => (VEHICLE_LABEL_LOOKUP[m.id] = m.label));
});

async function loadRouteList() {
  const listEl = document.getElementById("rcList");
  try {
    const res = await fetch(`${API_BASE}/custom-routes`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const routes = await res.json();

    if (!Array.isArray(routes) || routes.length === 0) {
      listEl.innerHTML = `<p class="rcListEmpty">ჯერ არცერთი მარშრუტი არ არის დამტკიცებული.<br>იყავი პირველი — დახატე შენი! ✏️</p>`;
      return;
    }

    listEl.innerHTML = routes
      .map((r) => {
        const badgeClass = r.vehicleType === "minibus" ? "rcCard__badge--minibus" : "rcCard__badge--bus";
        const modelLabel = VEHICLE_LABEL_LOOKUP[r.vehicleModel] || r.vehicleModel;
        return `
        <div class="rcCard" data-id="${escapeHtml(r.id)}">
          <div class="rcCard__top">
            <span class="rcCard__badge ${badgeClass}">${escapeHtml(r.routeNumber)}</span>
            <span class="rcCard__name">${escapeHtml(r.name)}</span>
          </div>
          <span class="rcCard__model">${escapeHtml(modelLabel)}</span>
          ${r.description ? `<p class="rcCard__desc">${escapeHtml(r.description)}</p>` : ""}
        </div>`;
      })
      .join("");

    listEl.querySelectorAll(".rcCard").forEach((card) => {
      card.addEventListener("click", () => {
        const route = routes.find((r) => r.id === card.dataset.id);
        if (route) openDetailPreview(route);
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="rcListEmpty">ვერ ჩაიტვირთა — სცადე გვერდის განახლება</p>`;
  }
}

/* ---------- დეტალების preview (მცირე რუკით) ---------- */
const detailOverlay = document.getElementById("rcDetailOverlay");
const detailSheet = document.getElementById("rcDetailSheet");
let detailMap = null;

function openDetailPreview(route) {
  document.getElementById("rcDetailName").textContent = `${route.routeNumber} — ${route.name}`;
  const modelLabel = VEHICLE_LABEL_LOOKUP[route.vehicleModel] || route.vehicleModel;
  document.getElementById("rcDetailMeta").textContent = modelLabel;
  document.getElementById("rcDetailDesc").textContent = route.description || "";

  detailOverlay.classList.remove("hidden");
  detailSheet.classList.remove("hidden");

  // მინი-რუკა route-ის ხაზით — ცალკე container-ს ვქმნით დინამიურად
  let mapContainer = document.getElementById("rcDetailMap");
  if (!mapContainer) {
    mapContainer = document.createElement("div");
    mapContainer.id = "rcDetailMap";
    mapContainer.style.cssText = "width:100%;height:200px;border-radius:12px;margin:10px 0;";
    document.getElementById("rcDetailDesc").insertAdjacentElement("afterend", mapContainer);
  }

  if (detailMap) {
    detailMap.remove();
    detailMap = null;
  }
  setTimeout(() => {
    detailMap = L.map("rcDetailMap", { zoomControl: false, dragging: false, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(detailMap);
    const line = L.polyline(route.points, { color: "#1f6fd6", weight: 4 }).addTo(detailMap);
    detailMap.fitBounds(line.getBounds(), { padding: [16, 16] });
  }, 50);
}

function closeDetailPreview() {
  detailOverlay.classList.add("hidden");
  detailSheet.classList.add("hidden");
}
document.getElementById("rcDetailClose").addEventListener("click", closeDetailPreview);
detailOverlay.addEventListener("click", closeDetailPreview);

/* ---------- გაშვება ---------- */
if (window.lucide) lucide.createIcons();
loadRouteList();

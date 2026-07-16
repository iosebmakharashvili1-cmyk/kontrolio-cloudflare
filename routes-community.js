/* ============================================================
   routes-community.js — საზოგადოების მარშრუტების გვერდი
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

const THEME_KEY = "kontrolio-theme";
const THEME_MANUAL_KEY = "kontrolio-theme-manual";
function getTbilisiHour() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tbilisi", hour: "2-digit", hour12: false }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === "hour").value) % 24;
}
document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem(THEME_MANUAL_KEY) === "true" ? (localStorage.getItem(THEME_KEY) || "light") : (getTbilisiHour() < 7 ? "dark" : "light")
);

const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

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
   Mode switching: list ⇄ draw ⇄ detail
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
let isDrawStep2 = false;
const isMobile = () => window.innerWidth < 900;

function enterDrawMode() {
  mode = "draw";
  isDrawStep2 = false;
  listBody.style.display = "none";
  rcPage.classList.remove("wide-list");
  rcPage.classList.add("draw-mode");
  drawWrap.classList.add("active");
  drawWrap.classList.remove("step2");
  submitBar.classList.add("active");
  addBtn.style.display = "none";
  headerTitle.textContent = "ახალი მარშრუტი";
  backBtn.removeAttribute("href");
  backBtn.addEventListener("click", exitDrawModeConfirm);
  updateStepUi();
  if (!map) initDrawMap();
  else setTimeout(() => map.invalidateSize(), 50);
}

function exitDrawModeConfirm(e) {
  e.preventDefault();
  if (drawPoints.length > 0 && !confirm("დახატული ხაზი დაიკარგება — გსურს გამოსვლა?")) return;
  exitDrawMode();
}

function exitDrawMode() {
  mode = "list";
  listBody.style.display = "";
  rcPage.classList.add("wide-list");
  rcPage.classList.remove("draw-mode");
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

/* ---------- Mobile 2-step wizard ---------- */
const stepNextBtn = document.getElementById("rcStepNextBtn");
const stepBackBtn = document.getElementById("rcStepBackBtn");
const stepBackBar = document.getElementById("rcStepBackBar");

function updateStepUi() {
  if (!isMobile()) {
    stepNextBtn.classList.add("hidden");
    stepBackBar.classList.add("hidden");
    return;
  }
  if (isDrawStep2) {
    stepNextBtn.classList.add("hidden");
    stepBackBar.classList.remove("hidden");
  } else {
    stepBackBar.classList.add("hidden");
    stepNextBtn.classList.toggle("hidden", drawPoints.length < 2);
  }
}
stepNextBtn.addEventListener("click", () => {
  if (drawPoints.length < 2) return;
  isDrawStep2 = true;
  drawWrap.classList.add("step2");
  updateStepUi();
});
stepBackBtn.addEventListener("click", () => {
  isDrawStep2 = false;
  drawWrap.classList.remove("step2");
  updateStepUi();
  if (map) setTimeout(() => map.invalidateSize(), 60);
});
window.addEventListener("resize", updateStepUi);

/* ============================================================
   Draw map — point-ების დამატება, drag, წაშლა
   ============================================================ */
let drawPoints = [];
let drawPolyline = null;
let pointMarkers = []; // L.marker (draggable, ვიზუალური)
let stopLinks = [];
let addStopMode = false;

function initDrawMap() {
  map = L.map("rcMap", { zoomControl: false }).setView([41.7151, 44.8271], 12.5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  map.on("click", (e) => {
    const idx = addDrawPoint(e.latlng.lat, e.latlng.lng);
    if (addStopMode) openStopPopup(idx);
  });
}

function redrawPolyline() {
  if (drawPolyline) map.removeLayer(drawPolyline);
  if (drawPoints.length >= 2) {
    const opts = { color: "#1f6fd6", weight: 5, opacity: 0.85 };
    drawPolyline =
      routeShape === "loop" && drawPoints.length >= 3
        ? L.polygon(drawPoints, { ...opts, fill: false }).addTo(map)
        : L.polyline(drawPoints, opts).addTo(map);
  }
}

/* point-ის მარკერი ახლა L.marker (Leaflet-ის native draggable
   მხარდაჭერით) — არა L.circleMarker + ცალკე hit-area, როგორც
   ადრე. ეს გვაძლევს: 1) გადათრევას (dragend → coords-ის
   განახლება), 2) დიდ, თითის-მოსახერხებელ touch-target-ს
   (48×48px CSS icon), 3) long-press-ს წასაშლელად. */
function buildPointIcon(idx) {
  const linked = stopLinks.some((s) => s.pointIndex === idx);
  const color = linked ? "#2ec4b6" : "#1f6fd6";
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function addDrawPoint(lat, lng) {
  const idx = drawPoints.length;
  drawPoints.push([lat, lng]);

  const marker = L.marker([lat, lng], {
    icon: buildPointIcon(idx),
    draggable: true,
    autoPan: true,
  }).addTo(map);

  marker.on("click", (e) => {
    L.DomEvent.stopPropagation(e.originalEvent);
    // Alt+click (დესკტოპზე) — წერტილის დაუყოვნებლივი წაშლა
    if (e.originalEvent && e.originalEvent.altKey) {
      removeDrawPoint(marker._pointIndex);
      return;
    }
    openStopPopup(marker._pointIndex);
  });

  marker.on("dragend", () => {
    const pos = marker.getLatLng();
    drawPoints[marker._pointIndex] = [pos.lat, pos.lng];
    redrawPolyline();
  });

  // long-press (მობილურზე) — წერტილის წაშლა.
  // შენიშვნა: Leaflet-ის draggable მარკერი "dragstart"-ს ისვრის
  // თითის/მაუსის უმცირეს (1-2px) მოძრაობაზეც კი, რაც ჩვეულებრივ
  // თან ახლავს touch/press-ს — ამიტომ ტაიმერი აღარ წყდება
  // dragstart-ზე პირდაპირ, არამედ მხოლოდ მაშინ, თუ მარკერი
  // რეალურად საგრძნობლად გადაინაცვლა (რაც ნიშნავს, რომ user-ს
  // მართლა გადათრევა სურდა და არა წაშლა).
  let pressTimer = null;
  let pressStartLatLng = null;
  let didActuallyDrag = false;

  marker.on("mousedown touchstart", () => {
    didActuallyDrag = false;
    pressStartLatLng = marker.getLatLng();
    pressTimer = setTimeout(() => {
      if (!didActuallyDrag) removeDrawPoint(marker._pointIndex);
    }, 550);
  });

  marker.on("drag", () => {
    if (!pressStartLatLng) return;
    const cur = marker.getLatLng();
    // ~ 2 მეტრზე მეტი გადაადგილება ითვლება რეალურ drag-ად
    const movedEnough =
      Math.abs(cur.lat - pressStartLatLng.lat) > 0.00002 ||
      Math.abs(cur.lng - pressStartLatLng.lng) > 0.00002;
    if (movedEnough) {
      didActuallyDrag = true;
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }
  });

  marker.on("mouseup touchend dragend", () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });

  marker._pointIndex = idx;
  pointMarkers.push(marker);
  redrawPolyline();
  updateDrawHint();
  updateStepUi();
  renderStopLinkList();
  return idx;
}

/* კონკრეტული წერტილის წაშლა (არა მხოლოდ ბოლოს) — ხაზის შუიდან
   წაშლისას ყველა შემდეგი point-ის ინდექსი და stopLinks-ის
   მიბმულობა გადაინომრება. */
function removeDrawPoint(idx) {
  if (idx < 0 || idx >= drawPoints.length) return;

  map.removeLayer(pointMarkers[idx]);
  drawPoints.splice(idx, 1);
  pointMarkers.splice(idx, 1);

  // stopLinks: ამ point-ზე მიბმული ჩანაწერი იშლება, ხოლო
  // idx-ზე მეტი pointIndex-ები 1-ით მცირდება
  stopLinks = stopLinks
    .filter((s) => s.pointIndex !== idx)
    .map((s) => (s.pointIndex > idx ? { ...s, pointIndex: s.pointIndex - 1 } : s));

  // დარჩენილი მარკერების ინდექსები და icon-ები განვაახლოთ
  pointMarkers.forEach((m, i) => {
    m._pointIndex = i;
    m.setIcon(buildPointIcon(i));
  });

  redrawPolyline();
  updateDrawHint();
  updateStepUi();
  renderStopLinkList();
}

function undoLastPoint() {
  if (drawPoints.length === 0) return;
  removeDrawPoint(drawPoints.length - 1);
}

function clearDrawing() {
  if (drawPoints.length > 0 && !confirm("ნამდვილად გსურს მთელი ხაზის წაშლა?")) return;
  resetDrawState();
}

function resetDrawState() {
  isDrawStep2 = false;
  drawWrap.classList.remove("step2");
  drawPoints = [];
  stopLinks = [];
  pointMarkers.forEach((m) => map && map.removeLayer(m));
  pointMarkers = [];
  if (drawPolyline && map) map.removeLayer(drawPolyline);
  drawPolyline = null;
  addStopMode = false;
  updateAddStopModeBtn();
  updateDrawHint();
  updateStepUi();
  renderStopLinkList();
  clearFormFields();
}

function updateDrawHint() {
  const hint = document.getElementById("rcDrawHint");
  if (addStopMode) {
    hint.textContent =
      drawPoints.length === 0
        ? "დააჭირე რუკას — წერტილიც დაემატება და გაჩერების არჩევასაც შემოგთავაზებ"
        : `${drawPoints.length} წერტილი — გააგრძელე`;
    return;
  }
  if (drawPoints.length === 0) hint.textContent = "დააჭირე რუკას, რომ დაიწყო ხაზის დახატვა";
  else if (drawPoints.length === 1) hint.textContent = "დააჭირე ისევ, რომ გააგრძელო ხაზი";
  else hint.textContent = `${drawPoints.length} წერტილი — აირჩიე "გაჩერების დამატება" ან დააჭირე წერტილს`;
}

document.getElementById("rcUndoBtn").addEventListener("click", undoLastPoint);
document.getElementById("rcClearBtn").addEventListener("click", clearDrawing);

const addStopModeBtn = document.getElementById("rcAddStopModeBtn");
function updateAddStopModeBtn() {
  addStopModeBtn.classList.toggle("active", addStopMode);
}
addStopModeBtn.addEventListener("click", () => {
  addStopMode = !addStopMode;
  updateAddStopModeBtn();
  updateDrawHint();
});

/* ---------- GPS "ჩემი ლოკაცია" ---------- */
let gpsMarker = null;
document.getElementById("rcGpsBtn").addEventListener("click", function () {
  if (!navigator.geolocation) {
    showToast("გეოლოკაცია მხარდაუჭერელია ამ ბრაუზერში");
    return;
  }
  const btn = this;
  btn.classList.add("active");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove("active");
      const { latitude, longitude } = pos.coords;
      if (gpsMarker) map.removeLayer(gpsMarker);
      gpsMarker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#8b5cf6",
        fillOpacity: 1,
      }).addTo(map);
      map.setView([latitude, longitude], 16);
    },
    () => {
      btn.classList.remove("active");
      showToast("ლოკაციაზე წვდომა ვერ მოხერხდა");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/* ============================================================
   Stop Picker — Leaflet Popup-ის შიგნით (search + create-new)
   ============================================================ */
function openStopPopup(pointIndex) {
  if (!map) return;
  map.closePopup();

  const pt = drawPoints[pointIndex];
  const existing = stopLinks.find((s) => s.pointIndex === pointIndex);
  const currentLabel = existing ? (existing._label || existing.customLabel || "") : "";

  const content = `
    <div style="min-width:220px;max-width:280px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--text);">
        <span style="background:var(--bus-blue);color:#fff;padding:2px 7px;border-radius:4px;margin-right:6px;font-family:var(--font-display);">#${pointIndex + 1}</span>
        გაჩერების მიბმა
      </div>
      <div style="margin-bottom:6px;">
        <input type="text" id="popupSearchInput" placeholder="მოძებნე გაჩერება..." autocomplete="off"
          style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--grey-soft);font-size:13px;font-family:inherit;" />
        <div id="popupResults" style="max-height:140px;overflow-y:auto;margin-top:4px;"></div>
      </div>
      <div style="margin:8px 0;text-align:center;color:var(--grey);font-size:11px;font-weight:600;">— ან —</div>
      <input type="text" id="popupNewInput" placeholder="ახალი გაჩერების სახელი..." maxlength="60"
        value="${escapeHtml(currentLabel)}"
        style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid var(--grey-soft);font-size:13px;font-family:inherit;" />
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button id="popupConfirmBtn" style="flex:1;padding:8px;border-radius:8px;border:none;background:var(--bus-blue);color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;font-family:inherit;">დადასტურება</button>
        <button id="popupRemoveBtn" style="padding:8px 10px;border-radius:8px;border:1px solid var(--red);background:transparent;color:var(--red);font-weight:600;font-size:12px;cursor:pointer;font-family:inherit;">მოხსნა</button>
      </div>
    </div>`;

  const popup = L.popup({ className: "rcPopup", closeButton: true, autoClose: false }).setLatLng(pt).setContent(content).openOn(map);

  setTimeout(() => {
    // დამატებითი დაცვა: popup-ის შიგნით ნებისმიერი დაწკაპუნება (მათ შორის
    // დინამიურად დამატებული საძიებო შედეგები) არასდროს უნდა "გაჟონოს"
    // ქვემოთ მდებარე რუკაზე — წინააღმდეგ შემთხვევაში map.on("click")
    // ხელახლა გაეშვება და იმავე წერტილში ახალ point-ს დაამატებს.
    const popupEl = popup.getElement ? popup.getElement() : null;
    if (popupEl) {
      L.DomEvent.disableClickPropagation(popupEl);
      L.DomEvent.disableScrollPropagation(popupEl);
    }

    const searchInput = document.getElementById("popupSearchInput");
    const resultsEl = document.getElementById("popupResults");
    const newInput = document.getElementById("popupNewInput");
    const confirmBtn = document.getElementById("popupConfirmBtn");
    const removeBtn = document.getElementById("popupRemoveBtn");

    if (searchInput && resultsEl) {
      searchInput.addEventListener("input", () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {
          resultsEl.innerHTML = "";
          return;
        }
        const matches = (typeof STOPS !== "undefined" ? STOPS : [])
          .filter((s) => s.name.toLowerCase().includes(q))
          .slice(0, 8);
        resultsEl.innerHTML =
          matches.length === 0
            ? `<p style="color:var(--grey);font-size:11px;text-align:center;padding:6px;">ვერაფერი მოიძებნა</p>`
            : matches
                .map(
                  (s) =>
                    `<div class="spResult" data-id="${escapeHtml(s.id)}" style="padding:6px 8px;border-radius:6px;background:var(--grey-soft);font-size:12px;cursor:pointer;margin-bottom:3px;">${escapeHtml(s.name)}</div>`
                )
                .join("");
        resultsEl.querySelectorAll(".spResult").forEach((el) => {
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            newInput.value = el.textContent;
            newInput.dataset.stopId = el.dataset.id;
            resultsEl.innerHTML = "";
          });
        });
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const label = newInput.value.trim();
        const stopId = newInput.dataset.stopId || null;
        if (!label && !stopId) {
          showToast("შეიყვანე გაჩერების სახელი");
          return;
        }
        stopLinks = stopLinks.filter((s) => s.pointIndex !== pointIndex);
        stopLinks.push({ pointIndex, stopId, customLabel: stopId ? null : label, _label: label || "?" });
        if (pointMarkers[pointIndex]) pointMarkers[pointIndex].setIcon(buildPointIcon(pointIndex));
        renderStopLinkList();
        map.closePopup();
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        stopLinks = stopLinks.filter((s) => s.pointIndex !== pointIndex);
        if (pointMarkers[pointIndex]) pointMarkers[pointIndex].setIcon(buildPointIcon(pointIndex));
        renderStopLinkList();
        map.closePopup();
      });
    }
    if (searchInput && !currentLabel) searchInput.focus();
  }, 50);
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
      if (pointMarkers[idx]) pointMarkers[idx].setIcon(buildPointIcon(idx));
    });
  });
  if (window.lucide) lucide.createIcons();
}

/* ============================================================
   ფორმა — ტიპი/მოდელი/ტიპი(ორმხრივი-წრიული)/ნომერი/სახელი/აღწერა
   ============================================================ */
let selectedVehicleType = "bus";
let routeShape = "oneway";
let currentRoutes = []; // ადრეულადვე გამოიყენება checkDuplicateRoute-ში

const routeNumberInput = document.getElementById("rcRouteNumber");
routeNumberInput.addEventListener("input", () => {
  routeNumberInput.value = routeNumberInput.value.replace(/\D/g, "").slice(0, 3);
  checkDuplicateRoute();
});

function populateModelSelect(type) {
  const select = document.getElementById("rcVehicleModel");
  select.innerHTML = (VEHICLE_MODELS[type] || []).map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
}
function selectVehicleType(type) {
  selectedVehicleType = type;
  document.getElementById("rcVehicleBus").classList.toggle("selected", type === "bus");
  document.getElementById("rcVehicleMinibus").classList.toggle("selected", type === "minibus");
  populateModelSelect(type);
  checkDuplicateRoute();
}
document.getElementById("rcVehicleBus").addEventListener("click", () => selectVehicleType("bus"));
document.getElementById("rcVehicleMinibus").addEventListener("click", () => selectVehicleType("minibus"));
selectVehicleType("bus");

function selectRouteShape(shape) {
  routeShape = shape;
  document.getElementById("rcShapeOneway").classList.toggle("selected", shape === "oneway");
  document.getElementById("rcShapeLoop").classList.toggle("selected", shape === "loop");
  redrawPolyline();
}
document.getElementById("rcShapeOneway").addEventListener("click", () => selectRouteShape("oneway"));
document.getElementById("rcShapeLoop").addEventListener("click", () => selectRouteShape("loop"));

function clearFormFields() {
  routeNumberInput.value = "";
  document.getElementById("rcRouteName").value = "";
  document.getElementById("rcRouteDesc").value = "";
  document.getElementById("rcRouteNumberError").textContent = "";
  document.getElementById("rcRouteNameError").textContent = "";
  document.getElementById("rcFormError").textContent = "";
  document.getElementById("rcDupWarning").innerHTML = "";
  selectVehicleType("bus");
  selectRouteShape("oneway");
}

/* ---------- დუბლიკატის შემოწმება ----------
   როცა route-number-ს (3 ციფრიანს) და ტიპს ერთდროულად ავსებ,
   ვამოწმებთ, უკვე არსებობს თუ არა ასეთივე ნომრის/ტიპის route —
   თუ დიახ, გაფრთხილება ჩნდება (submit-ს არ ვბლოკავთ — შესაძლოა
   ეს ნამდვილად ახალი/დამატებითი ვარიანტია იმავე ხაზისა). */
function checkDuplicateRoute() {
  const warnEl = document.getElementById("rcDupWarning");
  const num = routeNumberInput.value.trim();
  if (!/^\d{3}$/.test(num) || !Array.isArray(currentRoutes)) {
    warnEl.innerHTML = "";
    return;
  }
  const dup = currentRoutes.find((r) => r.routeNumber === num && r.vehicleType === selectedVehicleType);
  if (dup) {
    warnEl.innerHTML = `
      <div class="rcDupWarning">
        <i data-lucide="alert-triangle"></i>
        <span>№${escapeHtml(num)} უკვე არსებობს (${escapeHtml(dup.name)}). შეგიძლია მაინც გააგზავნო, თუ ეს დამატებითი ვარიანტია, ან <strong id="rcDupViewLink">ნახე არსებული</strong>.</span>
      </div>`;
    if (window.lucide) lucide.createIcons();
    const link = document.getElementById("rcDupViewLink");
    if (link) link.addEventListener("click", () => enterDetailMode(dup));
  } else {
    warnEl.innerHTML = "";
  }
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
    errEl.textContent = "დახატე მინიმუმ 2 წერტილიანი ხაზი";
    return;
  }
  if (routeShape === "loop" && drawPoints.length < 3) {
    errEl.textContent = "წრიულს 3+ წერტილი სჭირდება";
    return;
  }
  if (!ROUTE_NUMBER_PATTERN.test(routeNumber)) {
    document.getElementById("rcRouteNumberError").textContent = "ზუსტად 3 ციფრი";
    return;
  }
  document.getElementById("rcRouteNumberError").textContent = "";
  if (!NAME_PATTERN.test(name)) {
    document.getElementById("rcRouteNameError").textContent = "1-80 სიმბოლო";
    return;
  }
  document.getElementById("rcRouteNameError").textContent = "";

  const btn = document.getElementById("rcSubmitBtn");
  btn.disabled = true;
  btn.textContent = "იგზავნება...";

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

    showToast("გაგზავნილია! ადმინისტრატორი გადახედავს მალე");
    exitDrawMode();
    loadRouteList();
  } catch (err) {
    errEl.textContent = err.message || "შეცდომა — სცადე ისევ";
  } finally {
    btn.disabled = false;
    btn.textContent = "გაგზავნა განსახილველად";
  }
}
document.getElementById("rcSubmitBtn").addEventListener("click", submitRoute);

/* ============================================================
   სია — ძებნა/ფილტრი + thumbnail
   ============================================================ */
let searchQuery = "";
let filterType = "all";

function generateThumbnailSvg(route) {
  if (!route.points || route.points.length < 2) return "";
  const pts = route.points;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  pts.forEach(([lat, lng]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  });
  const padLat = (maxLat - minLat) * 0.15 || 0.005;
  const padLng = (maxLng - minLng) * 0.15 || 0.005;
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  const rangeLat = maxLat - minLat || 0.001;
  const rangeLng = maxLng - minLng || 0.001;
  const toX = (lng) => ((lng - minLng) / rangeLng) * 100;
  const toY = (lat) => 100 - ((lat - minLat) / rangeLat) * 100;
  const pointsStr = pts.map(([lat, lng]) => `${toX(lng).toFixed(1)},${toY(lat).toFixed(1)}`).join(" ");
  const tag = route.isLoop ? "polygon" : "polyline";
  const stopsMarkup = (route.stopLinks || [])
    .filter((s) => pts[s.pointIndex])
    .map((s) => {
      const [lat, lng] = pts[s.pointIndex];
      return `<circle cx="${toX(lng).toFixed(1)}" cy="${toY(lat).toFixed(1)}" r="2" fill="#2ec4b6" stroke="#fff" stroke-width="0.5"/>`;
    })
    .join("");
  return `<svg class="rcCard__thumbSvg" viewBox="0 0 100 100" preserveAspectRatio="none"><${tag} points="${pointsStr}"/>${stopsMarkup}</svg>`;
}

function getFilteredRoutes() {
  let list = currentRoutes;
  if (filterType !== "all") list = list.filter((r) => r.vehicleType === filterType);
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    list = list.filter(
      (r) => r.routeNumber.includes(q) || r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q)
    );
  }
  return list;
}

function renderRouteList() {
  const el = document.getElementById("rcList");
  const metaEl = document.getElementById("rcListMeta");
  const filtered = getFilteredRoutes();

  if (currentRoutes.length === 0) {
    metaEl.textContent = "";
  } else {
    metaEl.textContent = filtered.length === currentRoutes.length
      ? `სულ ${currentRoutes.length} მარშრუტი`
      : `${filtered.length} / ${currentRoutes.length} მარშრუტი`;
  }

  if (filtered.length === 0) {
    el.innerHTML = `
      <div class="emptyState" style="padding:50px 20px;grid-column:1/-1;">
        <div class="emptyState__icon"><i data-lucide="route" style="width:36px;height:36px;color:var(--grey);"></i></div>
        <div class="emptyState__title">${currentRoutes.length === 0 ? "მარშრუტები არ არის" : "ვერაფერი მოიძებნა"}</div>
        <div class="emptyState__sub">${currentRoutes.length === 0 ? "იყავი პირველი — დახატე შენი მარშრუტი!" : "სცადე სხვა საძიებო სიტყვა ან ფილტრი"}</div>
      </div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  el.innerHTML = filtered
    .map((r) => {
      const badgeClass = r.vehicleType === "minibus" ? "rcCard__badge--minibus" : "rcCard__badge--bus";
      const modelLabel = VEHICLE_LABEL_LOOKUP[r.vehicleModel] || r.vehicleModel;
      const stopCount = Array.isArray(r.stopLinks) ? r.stopLinks.length : 0;
      const thumb = generateThumbnailSvg(r);
      return `
        <div class="rcCard" data-id="${escapeHtml(r.id)}">
          ${thumb ? `
            <div class="rcCard__thumb">
              ${thumb}
              <span class="rcCard__thumbBadge">${escapeHtml(r.routeNumber)}</span>
              ${stopCount > 0 ? `<span class="rcCard__thumbStops"><i data-lucide="map-pin" style="width:9px;height:9px;"></i> ${stopCount}</span>` : ""}
            </div>` : ""}
          <div class="rcCard__top">
            <span class="rcCard__badge ${badgeClass}">${escapeHtml(r.routeNumber)}</span>
            <span class="rcCard__name">${escapeHtml(r.name)}</span>
          </div>
          <span class="rcCard__model">${escapeHtml(modelLabel)}</span>
          ${r.description ? `<p class="rcCard__desc">${escapeHtml(r.description)}</p>` : ""}
        </div>`;
    })
    .join("");

  el.querySelectorAll(".rcCard").forEach((card) => {
    card.addEventListener("click", () => {
      const route = currentRoutes.find((r) => r.id === card.dataset.id);
      if (route) enterDetailMode(route);
    });
  });
  if (window.lucide) lucide.createIcons();
}

async function loadRouteList() {
  const el = document.getElementById("rcList");
  try {
    const res = await fetch(`${API_BASE}/custom-routes`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentRoutes = await res.json();
    renderRouteList();
  } catch (err) {
    el.innerHTML = `<p class="rcListEmpty">ვერ ჩაიტვირთა — სცადე გვერდის განახლება</p>`;
  }
}

const searchInputEl = document.getElementById("rcSearchInput");
const filterSelectEl = document.getElementById("rcFilterSelect");
let searchDebounce = null;
searchInputEl.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = searchInputEl.value;
    renderRouteList();
  }, 200);
});
filterSelectEl.addEventListener("change", () => {
  filterType = filterSelectEl.value;
  renderRouteList();
});

/* ============================================================
   Route Detail — სრულმასშტაბიანი, ინტერაქტიული
   ============================================================ */
const detailWrap = document.getElementById("rcDetailWrap");
const rcDetailDelete = document.getElementById("rcDetailDelete");
let detailMap = null;
let activeDetailRouteId = null;
let detailResizeObserver = null;

function enterDetailMode(route) {
  mode = "detail";
  activeDetailRouteId = route.id;
  listBody.style.display = "none";
  rcPage.classList.remove("wide-list");
  detailWrap.classList.add("active");
  addBtn.style.display = "none";
  headerTitle.textContent = `№${route.routeNumber} — ${route.name}`;
  backBtn.removeAttribute("href");
  renderDetailInfo(route);
  window.scrollTo(0, 0);

  setTimeout(() => {
    if (detailMap) {
      detailMap.remove();
      detailMap = null;
    }
    detailMap = L.map("rcDetailFullMap", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(detailMap);

    const line = route.isLoop
      ? L.polygon(route.points, { color: "#1f6fd6", weight: 5, fill: false }).addTo(detailMap)
      : L.polyline(route.points, { color: "#1f6fd6", weight: 5 }).addTo(detailMap);

    (route.stopLinks || []).forEach((link) => {
      const pt = route.points[link.pointIndex];
      if (!pt) return;
      const label = link.stopId
        ? (STOPS.find((st) => st.id === link.stopId) || {}).name || link.customLabel || "?"
        : link.customLabel || "?";
      L.circleMarker(pt, { radius: 7, color: "#fff", weight: 2, fillColor: "#2ec4b6", fillOpacity: 1 })
        .addTo(detailMap)
        .bindTooltip(escapeHtml(label), { direction: "top" });
    });

    detailMap.fitBounds(line.getBounds(), { padding: [30, 30] });
    requestAnimationFrame(() => {
      if (detailMap) detailMap.invalidateSize();
    });

    const mapEl = document.getElementById("rcDetailFullMap");
    if (!detailResizeObserver) detailResizeObserver = new ResizeObserver(() => detailMap && detailMap.invalidateSize());
    else detailResizeObserver.disconnect();
    detailResizeObserver.observe(mapEl);
  }, 60);

  if (window.lucide) lucide.createIcons();
}

function renderDetailInfo(route) {
  const badgeClass = route.vehicleType === "minibus" ? "rcCard__badge--minibus" : "rcCard__badge--bus";
  document.getElementById("rcDetailBadge").className = `rcCard__badge ${badgeClass}`;
  document.getElementById("rcDetailBadge").textContent = route.routeNumber;
  document.getElementById("rcDetailName").textContent = route.name;

  const modelLabel = VEHICLE_LABEL_LOOKUP[route.vehicleModel] || route.vehicleModel;
  document.getElementById("rcDetailMeta2").innerHTML = `
    <span><i data-lucide="${route.vehicleType === "minibus" ? "truck" : "bus"}" style="width:14px;height:14px;"></i> ${escapeHtml(modelLabel)}</span>
    <span><i data-lucide="${route.isLoop ? "repeat" : "arrow-left-right"}" style="width:14px;height:14px;"></i> ${route.isLoop ? "წრიული" : "ორმხრივი"}</span>
    <span><i data-lucide="map-pin"></i> ${(route.stopLinks || []).length} გაჩერება</span>`;

  document.getElementById("rcDetailDesc").textContent = route.description || "";

  const stopsEl = document.getElementById("rcDetailStops");
  const links = (route.stopLinks || []).slice().sort((a, b) => a.pointIndex - b.pointIndex);
  stopsEl.innerHTML = links.length
    ? "<h4>გაჩერებები</h4>" +
      links
        .map((s, i) => {
          const label = s.stopId ? (STOPS.find((st) => st.id === s.stopId) || {}).name || s.customLabel || "?" : s.customLabel || "?";
          return `<div class="rcDetailStopItem"><span class="rcDetailStopItem__idx">${i + 1}</span><span>${escapeHtml(label)}</span></div>`;
        })
        .join("")
    : "";

  rcDetailDelete.classList.toggle("hidden", !isAdminMode());
  if (window.lucide) lucide.createIcons();
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
  if (detailResizeObserver) detailResizeObserver.disconnect();
  if (detailMap) {
    detailMap.remove();
    detailMap = null;
  }
}

/* ============================================================
   Admin — წაშლა
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
  if (!confirm("ნამდვილად გსურს ამ მარშრუტის წაშლა?")) return;
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
    showToast("წაშლილია");
    exitDetailMode();
    loadRouteList();
  } catch (err) {
    showToast("წაშლა ვერ მოხერხდა");
  }
});
if (new URLSearchParams(location.search).get("admin") === "1" && !isAdminMode()) getOrAskAdminPassword();

/* ============================================================
   Init
   ============================================================ */
if (window.lucide) lucide.createIcons();
document.getElementById("rcList").classList.add("rcListGrid");
if (window.matchMedia("(min-width: 900px)").matches) rcPage.classList.add("wide-list");
loadRouteList();

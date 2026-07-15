/* ============================================================
   routes-community.js — განახლებული ვერსია
   ============================================================ */
const API_BASE = "/api";
function getSid() { let s = localStorage.getItem("_kontrolio_sid"); if (!s) { s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); localStorage.setItem("_kontrolio_sid", s) } return s }
function escapeHtml(s) { return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }

// ... (Theme logic remains same)

const VEHICLE_LABEL_LOOKUP = {
    man18c: "MAN Lion's City 18C (CNG)", man12: "MAN Lion's City 12მ", bmc12: "BMC Procity 12მ",
    man10: "MAN 10მ (ლურჯი)", isuzu8: "Isuzu Novociti Life 8მ", fordtransit: "Ford Transit (ლურჯი)"
};

/* State */
let mode = "list", map = null, isDrawStep2 = false;
let drawPoints = [], markers = [], stopLinks = [], routeShape = "oneway";
let currentRoutes = [];

const rcPage = document.getElementById("rcPage"),
    listBody = document.getElementById("rcListBody"),
    drawWrap = document.getElementById("rcDrawWrap"),
    addBtn = document.getElementById("rcAddBtn"),
    backBtn = document.getElementById("rcBackBtn"),
    headerTitle = document.getElementById("rcHeaderTitle"),
    submitBar = document.getElementById("rcSubmitBar");

/* --- Search & Filter --- */
document.getElementById("rcSearchInput").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".rcCard").forEach(card => {
        const match = card.innerText.toLowerCase().includes(q);
        card.style.display = match ? "" : "none";
    });
});

/* --- GPS Location --- */
function setupGpsControl(mapInstance) {
    const gpsBtn = L.control({ position: 'topleft' });
    gpsBtn.onAdd = function () {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        div.innerHTML = '<button type="button" style="width:30px;height:30px;background:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:4px;" title="ჩემი ლოკაცია"><i data-lucide="crosshair" style="width:18px;color:#333;"></i></button>';
        div.onclick = () => {
            mapInstance.locate({ setView: true, maxZoom: 16 });
        };
        return div;
    };
    gpsBtn.addTo(mapInstance);
    if(window.lucide) lucide.createIcons();
}

/* --- Drawing Core --- */
function initDrawMap() {
    map = L.map("rcMap").setView([41.7151, 44.8271], 12.5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
    setupGpsControl(map);

    map.on("click", e => {
        if (isDrawStep2) return;
        addPoint(e.latlng);
    });
}

function addPoint(latlng) {
    const idx = drawPoints.length;
    drawPoints.push([latlng.lat, latlng.lng]);

    const m = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background:var(--bus-blue);width:12px;height:12px;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 5px rgba(0,0,0,0.3)"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        })
    }).addTo(map);

    // Drag event
    m.on('drag', (e) => {
        const newPos = e.target.getLatLng();
        drawPoints[idx] = [newPos.lat, newPos.lng];
        redrawPolyline();
    });

    // Right click to delete point
    m.on('contextmenu', () => {
        removePoint(idx);
    });

    // Click to link stop
    m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        openStopPopup(idx);
    });

    markers.push(m);
    redrawPolyline();
    updateDrawHint();
}

function removePoint(index) {
    map.removeLayer(markers[index]);
    markers.splice(index, 1);
    drawPoints.splice(index, 1);
    // Re-index remaining markers
    resetMarkersIndices();
    redrawPolyline();
    updateDrawHint();
}

function resetMarkersIndices() {
    // We clear and re-add to keep indices in sync with the array
    markers.forEach(m => map.removeLayer(m));
    const oldPoints = [...drawPoints];
    drawPoints = [];
    markers = [];
    oldPoints.forEach(p => addPoint(L.latLng(p[0], p[1])));
}

function redrawPolyline() {
    if (window.drawPolyline) map.removeLayer(window.drawPolyline);
    if (drawPoints.length < 2) return;

    const options = { color: "#1f6fd6", weight: 5, opacity: 0.8 };
    window.drawPolyline = (routeShape === "loop" && drawPoints.length >= 3)
        ? L.polygon(drawPoints, { ...options, fill: false }).addTo(map)
        : L.polyline(drawPoints, options).addTo(map);
}

/* --- Submission & Validation --- */
async function submitRoute() {
    const rn = document.getElementById("rcRouteNumber").value.trim();
    const err = document.getElementById("rcFormError");
    
    // Duplicate check
    const isDuplicate = currentRoutes.some(r => r.routeNumber === rn);
    if (isDuplicate) {
        err.textContent = "მარშრუტი ამ ნომრით უკვე არსებობს!";
        return;
    }

    if (drawPoints.length < 2) {
        err.textContent = "დახატეთ მინიმუმ 2 წერტილი";
        return;
    }

    // ... rest of the fetch logic (same as your original)
}

// ... (Keep existing UI toggle and list loading functions)

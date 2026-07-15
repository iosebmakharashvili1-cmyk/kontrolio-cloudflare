/**
 * Kontrolio - Community Routes JavaScript Module
 */
(function () {
  'use strict';

  let map = null;
  let detailMap = null;
  let polyline = null;
  let detailPolyline = null;
  let points = [];        // L.LatLng array
  let vertexMarkers = []; // Leaflet markers for dragging/deleting
  let routesData = [];
  let currentCity = localStorage.getItem("kontrolio-city") || "tbilisi";
  let selectedVehicle = "bus";
  let selectedShape = "oneway";
  let currentDetailRoute = null;

  // --- Initialization ---
  document.addEventListener("DOMContentLoaded", () => {
    initEvents();
    fetchRoutes();
  });

  function initEvents() {
    const addBtn = document.getElementById("rcAddBtn");
    const backBtn = document.getElementById("rcBackBtn");
    const undoBtn = document.getElementById("rcUndoBtn");
    const clearBtn = document.getElementById("rcClearBtn");
    const submitBtn = document.getElementById("rcSubmitBtn");
    const locateBtn = document.getElementById("rcMapLocateBtn");
    const searchInput = document.getElementById("rcSearchInput");
    const stepNextBtn = document.getElementById("rcStepNextBtn");
    const stepBackBtn = document.getElementById("rcStepBackBtn");

    if (addBtn) addBtn.onclick = () => openDrawMode();
    if (backBtn) backBtn.onclick = handleBackClick;
    if (undoBtn) undoBtn.onclick = undoLastPoint;
    if (clearBtn) clearBtn.onclick = clearAllPoints;
    if (submitBtn) submitBtn.onclick = submitCommunityRoute;
    if (locateBtn) locateBtn.onclick = locateUserOnMap;
    if (searchInput) searchInput.oninput = (e) => filterRoutes(e.target.value);
    
    if (stepNextBtn) {
      stepNextBtn.onclick = () => {
        document.getElementById("rcDrawWrap").classList.add("step2");
        document.getElementById("rcSubmitBar").classList.add("active");
      };
    }
    if (stepBackBtn) {
      stepBackBtn.onclick = () => {
        document.getElementById("rcDrawWrap").classList.remove("step2");
        document.getElementById("rcSubmitBar").classList.remove("active");
      };
    }

    // Vehicle Type Toggle
    const vBus = document.getElementById("rcVehicleBus");
    const vMinibus = document.getElementById("rcVehicleMinibus");
    if (vBus && vMinibus) {
      vBus.onclick = () => {
        selectedVehicle = "bus";
        vBus.classList.add("selected");
        vMinibus.classList.remove("selected");
      };
      vMinibus.onclick = () => {
        selectedVehicle = "minibus";
        vMinibus.classList.add("selected");
        vBus.classList.remove("selected");
      };
    }

    // Route Shape Toggle (Oneway / Loop)
    const sOneway = document.getElementById("rcShapeOneway");
    const sLoop = document.getElementById("rcShapeLoop");
    if (sOneway && sLoop) {
      sOneway.onclick = () => {
        selectedShape = "oneway";
        sOneway.classList.add("selected");
        sLoop.classList.remove("selected");
        updatePolyline();
      };
      sLoop.onclick = () => {
        selectedShape = "loop";
        sLoop.classList.add("selected");
        sOneway.classList.remove("selected");
        updatePolyline();
      };
    }
  }

  // --- Fetch and Render Routes ---
  async function fetchRoutes() {
    const listContainer = document.getElementById("rcList");
    if (!listContainer) return;

    try {
      const res = await fetch(`/api/community-routes?city=${currentCity}`);
      if (res.ok) {
        routesData = await res.json();
      } else {
        routesData = [];
      }
    } catch (e) {
      console.warn("API unavailable, fallback to local data if any.");
      routesData = [];
    }

    renderRoutesList(routesData);
  }

  function renderRoutesList(list) {
    const container = document.getElementById("rcList");
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = `<p class="rcListEmpty">მარშრუტები არ არის ნაპოვნი.</p>`;
      return;
    }

    container.innerHTML = list.map((route, idx) => {
      const isBus = route.vehicle !== "minibus";
      const badgeClass = isBus ? "rcCard__badge--bus" : "rcCard__badge--minibus";
      const vehicleLabel = isBus ? "ავტობუსი" : "მინიავტობუსი";
      
      return `
        <div class="rcCard" data-idx="${idx}">
          <div class="rcCard__top">
            <span class="rcCard__badge ${badgeClass}">${route.number || '—'}</span>
            <div class="rcCard__name">${escapeHtml(route.name || 'უსახელო')}</div>
          </div>
          <div class="rcCard__model">${vehicleLabel} • ${route.shape === 'loop' ? 'წრიული' : 'ორმხრივი'}</div>
          ${route.desc ? `<div class="rcCard__desc">${escapeHtml(route.desc)}</div>` : ''}
        </div>
      `;
    }).join("");

    // Add click listeners
    const cards = container.querySelectorAll(".rcCard");
    cards.forEach(card => {
      card.onclick = () => {
        const idx = card.getAttribute("data-idx");
        if (list[idx]) showRouteDetail(list[idx]);
      };
    });

    if (window.lucide) lucide.createIcons();
  }

  function filterRoutes(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      renderRoutesList(routesData);
      return;
    }
    const filtered = routesData.filter(r => 
      (r.number && r.number.toString().toLowerCase().includes(q)) ||
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.desc && r.desc.toLowerCase().includes(q))
    );
    renderRoutesList(filtered);
  }

  // --- Map & Drawing Logic ---
  function initDrawMap() {
    if (map) return;

    const defaultCenter = currentCity === "rustavi" ? [41.5345, 45.0142] : [41.7151, 44.8271];
    map = L.map("rcMap", { zoomControl: false }).setView(defaultCenter, 13);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19
    }).addTo(map);

    polyline = L.polyline([], {
      color: "var(--bus-blue)",
      weight: 4,
      opacity: 0.8
    }).addTo(map);

    map.on("click", (e) => {
      addPoint(e.latlng);
    });
  }

  function addPoint(latlng) {
    points.push(latlng);
    
    // Create draggable marker
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: 'rc-vertex-handle',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      })
    }).addTo(map);

    // Marker Drag Event
    marker.on('drag', (e) => {
      const idx = vertexMarkers.indexOf(marker);
      if (idx !== -1) {
        points[idx] = e.target.getLatLng();
        updatePolyline();
      }
    });

    // Marker Click Event -> Delete point
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      deletePoint(marker);
    });

    vertexMarkers.push(marker);
    updatePolyline();
    checkStepStatus();
  }

  function deletePoint(marker) {
    const idx = vertexMarkers.indexOf(marker);
    if (idx !== -1) {
      map.removeLayer(marker);
      vertexMarkers.splice(idx, 1);
      points.splice(idx, 1);
      updatePolyline();
      checkStepStatus();
    }
  }

  function undoLastPoint() {
    if (vertexMarkers.length === 0) return;
    const lastMarker = vertexMarkers[vertexMarkers.length - 1];
    deletePoint(lastMarker);
  }

  function clearAllPoints() {
    vertexMarkers.forEach(m => map.removeLayer(m));
    vertexMarkers = [];
    points = [];
    updatePolyline();
    checkStepStatus();
  }

  function updatePolyline() {
    if (!polyline) return;
    
    let renderPoints = [...points];
    if (selectedShape === "loop" && points.length > 2) {
      renderPoints.push(points[0]); // connect back to start
    }
    polyline.setLatLngs(renderPoints);
  }

  function checkStepStatus() {
    const nextBtn = document.getElementById("rcStepNextBtn");
    const submitBar = document.getElementById("rcSubmitBar");
    
    const isValid = points.length >= 2;
    if (nextBtn) nextBtn.classList.toggle("hidden", !isValid);
    
    // Desktop layout submit bar visibility
    if (window.innerWidth >= 900 && submitBar) {
      submitBar.classList.toggle("active", isValid);
    }
  }

  function locateUserOnMap() {
    if (!map) return;
    map.locate({ setView: true, maxZoom: 16 });
    map.once("locationfound", (e) => {
      L.circleMarker(e.latlng, {
        radius: 7,
        fillColor: "#3f6683",
        color: "#ffffff",
        weight: 2,
        fillOpacity: 1
      }).addTo(map);
    });
  }

  // --- Submit Route & Duplicate Check ---
  async function submitCommunityRoute() {
    const numInput = document.getElementById("rcRouteNumber");
    const nameInput = document.getElementById("rcRouteName");
    const descInput = document.getElementById("rcRouteDesc");
    const errEl = document.getElementById("rcFormError");

    const num = (numInput ? numInput.value : "").trim();
    const name = (nameInput ? nameInput.value : "").trim();
    const desc = (descInput ? descInput.value : "").trim();

    if (errEl) errEl.innerText = "";

    if (points.length < 2) {
      if (errEl) errEl.innerText = "გთხოვთ, რუკაზე მინიმუმ 2 წერტილი მონიშნოთ.";
      return;
    }
    if (!num) {
      if (errEl) errEl.innerText = "გთხოვთ მიუთითოთ მარშრუტის ნომერი.";
      return;
    }
    if (!name) {
      if (errEl) errEl.innerText = "გთხოვთ მიუთითოთ მარშრუტის დასახელება.";
      return;
    }

    // Duplicate check
    const isDuplicate = routesData.some(r => 
      r.number && r.number.toString() === num && r.city === currentCity
    );
    if (isDuplicate) {
      if (errEl) errEl.innerText = `მარშრუტი №${num} ამ ქალაქში უკვე არსებობს.`;
      return;
    }

    const payload = {
      number: num,
      name: name,
      desc: desc,
      vehicle: selectedVehicle,
      shape: selectedShape,
      city: currentCity,
      points: points.map(p => [p.lat, p.lng])
    };

    const submitBtn = document.getElementById("rcSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = "იგზავნება...";
    }

    try {
      const res = await fetch("/api/community-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast("მარშრუტი წარმატებით გაიგზავნა!");
        setTimeout(() => location.reload(), 1200);
      } else {
        throw new Error();
      }
    } catch (e) {
      if (errEl) errEl.innerText = "გაგზავნისას დაფიქსირდა შეცდომა. სცადეთ მოგვიანებით.";
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "გაგზავნა განსახილველად";
      }
    }
  }

  // --- Navigation & View Switchers ---
  function openDrawMode() {
    document.getElementById("rcListBody").style.display = "none";
    document.getElementById("rcDrawWrap").classList.add("active");
    document.getElementById("rcAddBtn").style.display = "none";
    document.getElementById("rcHeaderTitle").innerText = "ახლის დახატვა";

    setTimeout(() => {
      initDrawMap();
      if (map) map.invalidateSize();
    }, 150);
  }

  function handleBackClick(e) {
    const drawWrap = document.getElementById("rcDrawWrap");
    const detailWrap = document.getElementById("rcDetailWrap");

    if (drawWrap && drawWrap.classList.contains("active")) {
      e.preventDefault();
      drawWrap.classList.remove("active", "step2");
      document.getElementById("rcSubmitBar").classList.remove("active");
      document.getElementById("rcListBody").style.display = "block";
      document.getElementById("rcAddBtn").style.display = "flex";
      document.getElementById("rcHeaderTitle").innerText = "საზოგადოების მარშრუტები";
    } else if (detailWrap && detailWrap.classList.contains("active")) {
      e.preventDefault();
      detailWrap.classList.remove("active");
      document.getElementById("rcListBody").style.display = "block";
      document.getElementById("rcAddBtn").style.display = "flex";
      document.getElementById("rcHeaderTitle").innerText = "საზოგადოების მარშრუტები";
    }
  }

  function showRouteDetail(route) {
    currentDetailRoute = route;
    document.getElementById("rcListBody").style.display = "none";
    document.getElementById("rcAddBtn").style.display = "none";

    const detailWrap = document.getElementById("rcDetailWrap");
    detailWrap.classList.add("active");
    document.getElementById("rcHeaderTitle").innerText = `მარშრუტი №${route.number}`;

    document.getElementById("rcDetailName").innerText = route.name || "უსახელო";
    document.getElementById("rcDetailDesc").innerText = route.desc || "აღწერა არ არის.";
    
    const badge = document.getElementById("rcDetailBadge");
    if (badge) {
      badge.innerText = route.number;
      badge.className = `rcCard__badge ${route.vehicle === 'minibus' ? 'rcCard__badge--minibus' : 'rcCard__badge--bus'}`;
    }

    setTimeout(() => {
      if (!detailMap) {
        detailMap = L.map("rcDetailFullMap", { zoomControl: false });
        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png").addTo(detailMap);
      }
      
      if (detailPolyline) detailMap.removeLayer(detailPolyline);

      if (route.points && route.points.length > 0) {
        const latLngs = route.points.map(p => L.latLng(p[0], p[1]));
        detailPolyline = L.polyline(latLngs, { color: "var(--bus-blue)", weight: 5 }).addTo(detailMap);
        detailMap.fitBounds(detailPolyline.getBounds(), { padding: [30, 30] });
      }
      detailMap.invalidateSize();
    }, 150);
  }

  // --- Helpers ---
  function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

})();

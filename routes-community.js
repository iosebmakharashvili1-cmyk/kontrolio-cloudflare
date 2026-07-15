let rcMap;
let markerPoints = []; // ინახავს Leaflet Marker ობიექტებს
let polylinePath;
let allExistingRoutes = []; // აქ ჩაიტვირთება არსებული ნომრები

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initSearch();
    // იმიტაცია არსებული მარშრუტების (დუბლიკატის შესამოწმებლად)
    allExistingRoutes = ["155", "301", "314"]; 
});

// 1. ძებნის და ფილტრაციის ლოგიკა
function initSearch() {
    const input = document.getElementById('rcSearchInput');
    input.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.rcCard');
        cards.forEach(card => {
            const isVisible = card.innerText.toLowerCase().includes(value);
            card.style.display = isVisible ? 'flex' : 'none';
        });
    });
}

// 2. რუკის ინიციალიზაცია და წერტილების მართვა
function initMap() {
    if (rcMap) return;

    rcMap = L.map('rcMap').setView([41.7151, 44.8271], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(rcMap);

    polylinePath = L.polyline([], {
        color: '#3f6683',
        weight: 5,
        opacity: 0.8,
        smoothFactor: 1
    }).addTo(rcMap);

    // რუკაზე დაჭერა = ახალი წერტილი
    rcMap.on('click', (e) => {
        addNewMarker(e.latlng);
    });

    // GPS ღილაკი
    document.getElementById('rcGpsBtn').onclick = (e) => {
        e.stopPropagation();
        rcMap.locate({setView: true, maxZoom: 16});
    };
}

function addNewMarker(latlng) {
    const marker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({
            className: 'draw-marker-icon',
            iconSize: [12, 12]
        })
    }).addTo(rcMap);

    // წერტილის Drag (გადაადგილება)
    marker.on('drag', updatePolyline);

    // მარჯვენა ღილაკით წაშლა (Right Click / Long Press)
    marker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        rcMap.removeLayer(marker);
        markerPoints = markerPoints.filter(m => m !== marker);
        updatePolyline();
    });

    markerPoints.push(marker);
    updatePolyline();
}

function updatePolyline() {
    const coords = markerPoints.map(m => m.getLatLng());
    polylinePath.setLatLngs(coords);
    
    // თუ 2 წერტილი მაინც გვაქვს, ვაჩვენებთ "გაგრძელებას"
    const nextBtn = document.getElementById('rcStepNextBtn');
    if (coords.length >= 2) {
        nextBtn.classList.remove('hidden');
    } else {
        nextBtn.classList.add('hidden');
    }
}

// 3. რედაქტირების ღილაკები
document.getElementById('rcAddBtn').onclick = () => {
    document.getElementById('rcListBody').style.display = 'none';
    document.getElementById('rcDrawWrap').classList.add('active');
    initMap();
    setTimeout(() => rcMap.invalidateSize(), 200);
};

document.getElementById('rcUndoBtn').onclick = () => {
    const lastMarker = markerPoints.pop();
    if (lastMarker) rcMap.removeLayer(lastMarker);
    updatePolyline();
};

document.getElementById('rcClearBtn').onclick = () => {
    markerPoints.forEach(m => rcMap.removeLayer(m));
    markerPoints = [];
    updatePolyline();
};

// 4. დუბლიკატების შემოწმება და გაგზავნა
document.getElementById('rcSubmitBtn').onclick = () => {
    const routeNum = document.getElementById('rcRouteNumber').value.trim();
    const errorMsg = document.getElementById('rcRouteNumberError');
    
    // ვალიდაცია
    if (!routeNum) {
        errorMsg.innerText = "გთხოვთ შეიყვანოთ ნომერი";
        return;
    }
    
    if (allExistingRoutes.includes(routeNum)) {
        errorMsg.innerText = "⚠️ ეს მარშრუტი უკვე არსებობს!";
        return;
    }

    if (markerPoints.length < 2) {
        alert("გთხოვთ მონიშნოთ მარშრუტის გზა რუკაზე");
        return;
    }

    errorMsg.innerText = "";
    alert("მადლობა! მარშრუტი გაიგზავნა გადასამოწმებლად.");
    location.reload(); // დაბრუნება სიაში
};

// მობილურისთვის "გაგრძელება" ღილაკის ლოგიკა
document.getElementById('rcStepNextBtn').onclick = () => {
    document.querySelector('.rcDrawWrap').classList.add('step2');
    document.getElementById('rcStepBackBar').classList.remove('hidden');
};

document.getElementById('rcStepBackBtn').onclick = () => {
    document.querySelector('.rcDrawWrap').classList.remove('step2');
    document.getElementById('rcStepBackBar').classList.add('hidden');
};

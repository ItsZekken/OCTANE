/**
 * OCTANE // KINETIC — GPS Route Map Instrument
 * 
 * Industrial cartographic surface for daily journey visualization:
 * - 100% zero-key map (Esri World Dark Gray Base + OpenStreetMap dark fallback)
 * - Instant zero-latency SVG route projection when offline or while tiles stream
 * - High-contrast speed flow palette:
 *   - Crimson Red (#EF4444) for dense congestion (< 12 km/h)
 *   - Red-Orange (#F97316) for heavy slow traffic (12-24 km/h)
 *   - Octane Amber (#F59E0B) for moderate urban flow (24-38 km/h)
 *   - Golden Yellow (#FACC15) for agile cruising (38-52 km/h)
 *   - Electric Yellow (#FFFF00) for fast highway cruising (>= 52 km/h)
 * - Dynamic spatial focus: tapping a journey dims all unselected routes to 10% dark charcoal
 *   and prominently highlights the focused route with A/B pins and glowing halo.
 */

import { speedSegments } from '../../core/iopgps-sync.js';

let leafletLoaderPromise = null;

const SPEED_STYLES = {
    crawl:    { color: '#EF4444', weight: 4.0, opacity: 0.95 },
    slow:     { color: '#F97316', weight: 3.5, opacity: 0.90 },
    moderate: { color: '#F59E0B', weight: 3.2, opacity: 0.88 },
    fluid:    { color: '#FACC15', weight: 2.8, opacity: 0.92 },
    fast:     { color: '#FFFF00', weight: 2.5, opacity: 0.95 }
};

/**
 * Loads Leaflet on-demand from CDN without blocking page rendering.
 * @returns {Promise<any>}
 */
export function ensureLeaflet() {
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (window.L) return Promise.resolve(window.L);
    if (leafletLoaderPromise) return leafletLoaderPromise;

    leafletLoaderPromise = new Promise((resolve) => {
        try {
            if (!document.querySelector('link[data-octane-leaflet]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                link.setAttribute('data-octane-leaflet', 'true');
                document.head.appendChild(link);
            }

            if (!document.getElementById('octane-map-dark-styles')) {
                const style = document.createElement('style');
                style.id = 'octane-map-dark-styles';
                style.textContent = `
                    .octane-esri-dark-tiles {
                        filter: brightness(0.9) contrast(1.15);
                    }
                    .octane-osm-dark-tiles {
                        filter: invert(100%) hue-rotate(180deg) brightness(85%) contrast(120%) grayscale(25%);
                    }
                    .leaflet-container {
                        background: #09090b !important;
                    }
                    .leaflet-tile {
                        image-rendering: -webkit-optimize-contrast;
                        image-rendering: crisp-edges;
                    }
                `;
                document.head.appendChild(style);
            }

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.async = true;
            script.onload = () => resolve(window.L || null);
            script.onerror = () => resolve(null);
            document.head.appendChild(script);
        } catch (_) {
            resolve(null);
        }
    });

    return leafletLoaderPromise;
}

/**
 * Creates an industrial route map inside the provided container element.
 * 
 * @param {HTMLElement} containerEl
 * @param {Object} [options={}]
 * @returns {Object} Map controller { showDay, focusTrip, unfocusTrip, destroy }
 */
export function createRouteMap(containerEl, options = {}) {
    if (!containerEl) return { showDay() {}, focusTrip() {}, unfocusTrip() {}, destroy() {} };

    let leafletMap = null;
    let dayPolylines = []; // Array<{ tripId, layers: Array<{ poly, category }>, tripLatLngs, startDot, endDot }>
    let tripMarkers = [];
    let focusedHaloPoly = null;
    let currentDayTrips = [];
    let currentDayBounds = null;
    let pendingFocusTrip = options.initialFocusTrip || null;

    /**
     * Renders responsive SVG route visualization for zero-latency instant display.
     */
    function renderSvgInstant(allPoints = [], focusedTripPts = []) {
        if (!Array.isArray(allPoints) || allPoints.length < 2) {
            containerEl.innerHTML = `
                <div class="w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] font-mono text-xs gap-2 select-none bg-[var(--bg-void)]">
                    <span class="tracking-widest uppercase text-[10px]">Sin coordenadas GPS registradas</span>
                </div>
            `;
            return;
        }

        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;

        for (const p of allPoints) {
            const lat = Number(p.lat || p[0]);
            const lng = Number(p.lng || p[1]);
            if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
            }
        }

        const latSpan = Math.max(0.0005, maxLat - minLat);
        const lngSpan = Math.max(0.0005, maxLng - minLng);
        const padX = lngSpan * 0.10;
        const padY = latSpan * 0.10;

        const adjMinLat = minLat - padY;
        const adjMaxLat = maxLat + padY;
        const adjMinLng = minLng - padX;
        const adjMaxLng = maxLng + padX;
        const spanX = Math.max(0.0001, adjMaxLng - adjMinLng);
        const spanY = Math.max(0.0001, adjMaxLat - adjMinLat);

        const w = 640;
        const h = 320;
        const toSvg = (lat, lng) => [
            Number((((lng - adjMinLng) / spanX) * w).toFixed(1)),
            Number((h - ((lat - adjMinLat) / spanY) * h).toFixed(1))
        ];

        const pathD = allPoints.map((p, idx) => {
            const [x, y] = toSvg(p.lat, p.lng);
            return idx === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        }).join(' ');

        const hasFocus = Array.isArray(focusedTripPts) && focusedTripPts.length >= 2;
        const focusPathD = hasFocus ? focusedTripPts.map((p, idx) => {
            const [x, y] = toSvg(p.lat, p.lng);
            return idx === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        }).join(' ') : '';

        containerEl.innerHTML = `
            <div class="w-full h-full relative overflow-hidden bg-[var(--bg-void)] select-none">
                <svg viewBox="0 0 ${w} ${h}" class="w-full h-full block" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <linearGradient id="route-speed-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stop-color="#EF4444" />
                            <stop offset="25%" stop-color="#F97316" />
                            <stop offset="50%" stop-color="#F59E0B" />
                            <stop offset="75%" stop-color="#FACC15" />
                            <stop offset="100%" stop-color="#FFFF00" />
                        </linearGradient>
                    </defs>
                    <!-- Grid background -->
                    <line x1="0" y1="${h * 0.5}" x2="${w}" y2="${h * 0.5}" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
                    <line x1="${w * 0.5}" y1="0" x2="${w * 0.5}" y2="${h}" stroke="rgba(255,255,255,0.05)" stroke-width="1" />
                    <!-- Base Day Path -->
                    <path d="${pathD}" fill="none" stroke="${hasFocus ? '#26262B' : 'url(#route-speed-grad)'}" stroke-width="${hasFocus ? 2 : 3.5}" stroke-linecap="round" stroke-linejoin="round" opacity="${hasFocus ? 0.35 : 0.9}" />
                    ${hasFocus ? `
                        <!-- Focused Trip with Glow -->
                        <path d="${focusPathD}" fill="none" stroke="#F97316" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.35" />
                        <path d="${focusPathD}" fill="none" stroke="url(#route-speed-grad)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
                    ` : ''}
                </svg>
            </div>
        `;
    }

    /**
     * Internal implementation of journey focus.
     */
    function applyFocus(selectedTrip, animate = true) {
        if (!selectedTrip) return;
        const pts = Array.isArray(selectedTrip.trackPoints) ? selectedTrip.trackPoints : [];
        if (pts.length < 2) return;

        if (!leafletMap || dayPolylines.length === 0) {
            pendingFocusTrip = selectedTrip;
            renderSvgInstant(currentDayTrips.flatMap(t => t.trackPoints || []), pts);
            return;
        }

        const L = window.L;
        if (!L) return;

        // Clean previous markers and halo
        tripMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        tripMarkers = [];
        if (focusedHaloPoly) {
            try { focusedHaloPoly.remove(); } catch (_) {}
            focusedHaloPoly = null;
        }

        const targetLatLngs = pts.map(p => [p.lat, p.lng]);

        // 1. Dim all unselected trips to faint dark charcoal (opacity 0.10, weight 1.5)
        // 2. Light up selected trip with full high-contrast speed colors (opacity 1.0, weight boosted +1.2)
        for (const item of dayPolylines) {
            const isTarget = item.tripId === selectedTrip.id;
            if (isTarget) {
                for (const { poly, category } of item.layers) {
                    const base = SPEED_STYLES[category] || SPEED_STYLES.moderate;
                    poly.setStyle({
                        color: base.color,
                        weight: base.weight + 0.6,
                        opacity: 1.0
                    });
                    try { poly.bringToFront(); } catch (_) {}
                }
                if (item.startDot) item.startDot.setStyle({ opacity: 0, fillOpacity: 0 });
                if (item.endDot) item.endDot.setStyle({ opacity: 0, fillOpacity: 0 });
            } else {
                for (const { poly } of item.layers) {
                    poly.setStyle({
                        color: '#26262B',
                        weight: 1.5,
                        opacity: 0.10
                    });
                }
                if (item.startDot) item.startDot.setStyle({ opacity: 0, fillOpacity: 0 });
                if (item.endDot) item.endDot.setStyle({ opacity: 0, fillOpacity: 0 });
            }
        }

        // 3. Subtle outer glowing halo under the focused trajectory (crisp, non-blurry)
        focusedHaloPoly = L.polyline(targetLatLngs, {
            color: '#F97316',
            weight: 6,
            opacity: 0.20,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(leafletMap);
        try { focusedHaloPoly.bringToBack(); } catch (_) {}

        // 4. Distinct A (Origin) and B (Destination) pins on focused trip
        const iconA = L.divIcon({
            className: 'octane-marker-origin',
            html: `
                <div style="width:22px;height:22px;border-radius:50%;background:#10B981;border:2px solid #09090B;display:flex;align-items:center;justify-content:center;color:#09090B;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;box-shadow:0 0 12px rgba(16,185,129,0.8);">
                    A
                </div>
            `,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });

        const iconB = L.divIcon({
            className: 'octane-marker-dest',
            html: `
                <div style="width:22px;height:22px;border-radius:50%;background:#EF4444;border:2px solid #09090B;display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:10px;box-shadow:0 0 12px rgba(239,68,68,0.8);">
                    B
                </div>
            `,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });

        const markerA = L.marker(targetLatLngs[0], { icon: iconA }).addTo(leafletMap);
        const markerB = L.marker(targetLatLngs[targetLatLngs.length - 1], { icon: iconB }).addTo(leafletMap);
        tripMarkers.push(markerA, markerB);

        // 5. Camera framing: crisp, fast linear transition without multi-level parabolic blur
        const tripBounds = L.latLngBounds(targetLatLngs);
        if (animate) {
            leafletMap.fitBounds(tripBounds, {
                padding: [36, 36],
                maxZoom: 16,
                animate: true,
                duration: 0.25,
                easeLinearity: 0.25
            });
        } else {
            leafletMap.fitBounds(tripBounds, { padding: [36, 36], maxZoom: 16 });
        }
    }

    /**
     * Shows all routes of a given day.
     * 
     * @param {Array<Object>} trips - List of trips for the day
     * @param {Array<Object>} [allPoints=[]] - All combined trackPoints of the day
     * @param {Object} [opts={}] - Optional { initialFocusTrip }
     */
    function showDay(trips = [], allPoints = [], opts = {}) {
        currentDayTrips = trips;
        if (opts.initialFocusTrip) {
            pendingFocusTrip = opts.initialFocusTrip;
        }

        const combinedPts = (allPoints.length > 0 ? allPoints : trips.flatMap(t => t.trackPoints || [])).filter(p => p && (p.lat || p.lng));

        // 1. Instant zero-latency SVG
        renderSvgInstant(combinedPts, pendingFocusTrip?.trackPoints || []);

        if (combinedPts.length < 2) return;

        // 2. Progressive enhancement with Leaflet
        ensureLeaflet().then((L) => {
            if (!L || !containerEl.isConnected) return;

            // Clear and prepare Leaflet container
            containerEl.innerHTML = '';
            const mapDiv = document.createElement('div');
            mapDiv.className = 'w-full h-full bg-[#09090B]';
            containerEl.appendChild(mapDiv);

            if (leafletMap) {
                try { leafletMap.remove(); } catch (_) {}
                leafletMap = null;
            }

            try {
                leafletMap = L.map(mapDiv, {
                    zoomControl: false,
                    attributionControl: false,
                    scrollWheelZoom: true,
                    doubleClickZoom: true,
                    dragging: true,
                    zoomSnap: 1,
                    zoomDelta: 1,
                    zoomAnimationThreshold: 2
                });

                // Primary Layer: Esri World Dark Gray Base (100% Free, Zero API Key)
                const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 16,
                    maxNativeZoom: 16,
                    attribution: false,
                    className: 'octane-esri-dark-tiles'
                });

                esriLayer.on('tileerror', () => {
                    if (!leafletMap._osmFallback) {
                        leafletMap._osmFallback = true;
                        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                            maxZoom: 18,
                            attribution: false,
                            className: 'octane-osm-dark-tiles'
                        }).addTo(leafletMap);
                    }
                });

                esriLayer.addTo(leafletMap);

                dayPolylines = [];
                tripMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
                tripMarkers = [];
                if (focusedHaloPoly) {
                    try { focusedHaloPoly.remove(); } catch (_) {}
                    focusedHaloPoly = null;
                }

                const allLatLngs = [];

                // Render each trip with speed segment encoding
                for (const trip of trips) {
                    const pts = Array.isArray(trip.trackPoints) ? trip.trackPoints : [];
                    if (pts.length < 2) continue;

                    const tripLatLngs = pts.map(p => [p.lat, p.lng]);
                    allLatLngs.push(...tripLatLngs);

                    const segments = speedSegments(pts);
                    const layers = [];

                    for (const seg of segments) {
                        const segLatLngs = seg.points.map(p => [p.lat, p.lng]);
                        const segStyle = SPEED_STYLES[seg.category] || SPEED_STYLES.moderate;

                        const poly = L.polyline(segLatLngs, {
                            color: segStyle.color,
                            weight: segStyle.weight,
                            opacity: segStyle.opacity,
                            lineCap: 'round',
                            lineJoin: 'round'
                        }).addTo(leafletMap);

                        layers.push({ poly, category: seg.category });
                    }

                    // Start/End micro markers
                    const startDot = L.circleMarker(tripLatLngs[0], {
                        radius: 4,
                        color: '#09090B',
                        weight: 1.5,
                        fillColor: '#10B981',
                        fillOpacity: 0.9
                    }).addTo(leafletMap);

                    const endDot = L.circleMarker(tripLatLngs[tripLatLngs.length - 1], {
                        radius: 4,
                        color: '#09090B',
                        weight: 1.5,
                        fillColor: '#EF4444',
                        fillOpacity: 0.9
                    }).addTo(leafletMap);

                    tripMarkers.push(startDot, endDot);
                    dayPolylines.push({ tripId: trip.id, layers, tripLatLngs, startDot, endDot });
                }

                if (allLatLngs.length >= 2) {
                    currentDayBounds = L.latLngBounds(allLatLngs);
                }

                if (pendingFocusTrip) {
                    applyFocus(pendingFocusTrip, false);
                } else if (currentDayBounds) {
                    leafletMap.fitBounds(currentDayBounds, { padding: [24, 24], maxZoom: 16 });
                }
            } catch (err) {
                console.warn('[OCTANE MAP] Fallback to SVG:', err?.message);
                renderSvgInstant(combinedPts, pendingFocusTrip?.trackPoints || []);
            }
        });
    }

    /**
     * Focuses the camera on a single trip and dims the other trips of the day to 10% opacity.
     * Preserves spatial day context while drawing immediate attention to the selected journey.
     * 
     * @param {Object} selectedTrip
     */
    function focusTrip(selectedTrip) {
        pendingFocusTrip = selectedTrip;
        applyFocus(selectedTrip, true);
    }

    /**
     * Unfocuses any selected trip and restores the full day's view.
     */
    function unfocusTrip() {
        pendingFocusTrip = null;

        if (focusedHaloPoly) {
            try { focusedHaloPoly.remove(); } catch (_) {}
            focusedHaloPoly = null;
        }

        tripMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        tripMarkers = [];

        if (!leafletMap) {
            renderSvgInstant(currentDayTrips.flatMap(t => t.trackPoints || []));
            return;
        }

        // Restore full multi-stop speed colors and opacities to all trips
        for (const item of dayPolylines) {
            for (const { poly, category } of item.layers) {
                const base = SPEED_STYLES[category] || SPEED_STYLES.moderate;
                poly.setStyle({
                    color: base.color,
                    weight: base.weight,
                    opacity: base.opacity
                });
            }
            if (item.startDot) item.startDot.setStyle({ opacity: 1, fillOpacity: 0.9 });
            if (item.endDot) item.endDot.setStyle({ opacity: 1, fillOpacity: 0.9 });
        }

        if (currentDayBounds) {
            leafletMap.fitBounds(currentDayBounds, {
                padding: [24, 24],
                maxZoom: 16,
                animate: true,
                duration: 0.25,
                easeLinearity: 0.25
            });
        }
    }

    function destroy() {
        if (focusedHaloPoly) {
            try { focusedHaloPoly.remove(); } catch (_) {}
            focusedHaloPoly = null;
        }
        tripMarkers.forEach(m => { try { m.remove(); } catch (_) {} });
        tripMarkers = [];
        if (leafletMap) {
            try { leafletMap.remove(); } catch (_) {}
            leafletMap = null;
        }
        dayPolylines = [];
        currentDayTrips = [];
        currentDayBounds = null;
        pendingFocusTrip = null;
    }

    return {
        showDay,
        focusTrip,
        unfocusTrip,
        destroy
    };
}
